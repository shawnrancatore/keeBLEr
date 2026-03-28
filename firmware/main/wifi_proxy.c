// SPDX-License-Identifier: MIT
/*
 * Keebler WiFi BLE-to-HTTP Proxy
 *
 * WiFi STA management + HTTP request execution over WiFi, controlled via BLE.
 * See wifi_proxy.h for overview.
 */

#include "wifi_proxy.h"
#include "board_config.h"
#include "ble_transport.h"
#include "serial_transport.h"

#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "lwip/ip4_addr.h"
#include "esp_mac.h"

static const char *TAG = "wifi_proxy";

/* ========================================================================= */
/*  NVS Keys                                                                 */
/* ========================================================================= */

#define NVS_NAMESPACE       "keebler"
#define NVS_KEY_WIFI_SSID   "wifi_ssid"
#define NVS_KEY_WIFI_PASS   "wifi_pass"
#define NVS_KEY_WIFI_TOKEN  "wifi_token"
#define NVS_KEY_WIFI_BOOTS  "wifi_boots"

/* ========================================================================= */
/*  Constants                                                                */
/* ========================================================================= */

#define WIFI_TASK_STACK     8192
#define WIFI_TASK_PRIO      4
#define CMD_QUEUE_SIZE      8

#define HTTP_CHUNK_SIZE     128
#define HTTP_CHUNK_DELAY_MS 2
#define HTTP_RETRY_DELAY_MS 10
#define HTTP_TIMEOUT_MS     15000

#define MAX_HEADERS         16
#define MAX_HEADER_KEY_LEN  64
#define MAX_HEADER_VAL_LEN  128

/* ========================================================================= */
/*  Command types for the worker task queue                                  */
/* ========================================================================= */

typedef enum {
    CMD_SCAN,
    CMD_CONNECT,
    CMD_DISCONNECT,
    CMD_STATUS,
    CMD_HTTP_EXECUTE,
    CMD_FORGET,
    CMD_AP_START,
} wifi_cmd_type_t;

/* ========================================================================= */
/*  HTTP request assembly state                                              */
/* ========================================================================= */

typedef struct {
    char key[MAX_HEADER_KEY_LEN];
    char val[MAX_HEADER_VAL_LEN];
} http_header_t;

typedef struct {
    uint8_t  method;
    char     url[KB_WIFI_MAX_URL_LEN + 1];
    size_t   url_len;
    uint8_t *body;
    size_t   body_len;
    size_t   body_cap;
    http_header_t headers[MAX_HEADERS];
    uint8_t  header_count;
    bool     active;        /* assembly in progress */
} http_request_t;

/* ========================================================================= */
/*  Worker task command payload                                              */
/* ========================================================================= */

typedef struct {
    wifi_cmd_type_t type;
    uint8_t         transport;
    union {
        struct {
            char ssid[33];
            char pass[65];
        } connect;
        http_request_t *http_req;   /* heap-allocated, task frees it */
    };
} wifi_cmd_t;

/* ========================================================================= */
/*  Module State                                                             */
/* ========================================================================= */

static uint8_t  s_wifi_state = KB_WIFI_STATE_OFF;
static esp_ip4_addr_t s_ip_addr;
static char     s_connected_ssid[33];

static uint8_t  s_token[KB_WIFI_TOKEN_LEN];
static bool     s_token_valid = false;

static bool     s_wifi_initialized = false;
static bool     s_ap_mode = false;
static esp_netif_t *s_sta_netif = NULL;
static esp_netif_t *s_ap_netif = NULL;

static QueueHandle_t s_cmd_queue = NULL;
static TaskHandle_t  s_task_handle = NULL;

/* Current HTTP request being assembled (inline, not queued yet) */
static http_request_t s_http_assembly;
static bool s_http_in_progress = false;  /* true while worker executes HTTP */

/* ========================================================================= */
/*  Response helpers                                                         */
/* ========================================================================= */

static void send_response(uint8_t type, const uint8_t *payload, uint8_t len,
                          uint8_t transport)
{
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t frame_len = kb_pack_frame(frame, sizeof(frame), type, payload, len);
    if (frame_len == 0) return;

    if (transport == KB_TRANSPORT_BLE) {
        kb_ble_send(frame, frame_len);
    } else if (transport == KB_TRANSPORT_UART) {
        serial_transport_send(frame, frame_len);
    }
}

static void send_ack(uint8_t status, uint8_t transport)
{
    send_response(KB_PKT_ACK, &status, 1, transport);
}

/**
 * Send a BLE response with retry on ESP_ERR_NO_MEM (mbuf exhaustion).
 * Used for streaming HTTP response body chunks.
 */
static void send_ble_with_backpressure(const uint8_t *frame, size_t frame_len,
                                       uint8_t transport)
{
    if (transport == KB_TRANSPORT_BLE) {
        for (int attempt = 0; attempt < 5; attempt++) {
            esp_err_t err = kb_ble_send(frame, frame_len);
            if (err != ESP_ERR_NO_MEM) return;
            vTaskDelay(pdMS_TO_TICKS(HTTP_RETRY_DELAY_MS));
        }
        ESP_LOGW(TAG, "BLE send failed after retries");
    } else if (transport == KB_TRANSPORT_UART) {
        serial_transport_send(frame, frame_len);
    }
}

/* ========================================================================= */
/*  Token Management                                                         */
/* ========================================================================= */

static bool token_is_zero(const uint8_t *token)
{
    for (int i = 0; i < KB_WIFI_TOKEN_LEN; i++) {
        if (token[i] != 0) return false;
    }
    return true;
}

/** Constant-time comparison */
static bool token_compare(const uint8_t *a, const uint8_t *b)
{
    uint8_t diff = 0;
    for (int i = 0; i < KB_WIFI_TOKEN_LEN; i++) {
        diff |= a[i] ^ b[i];
    }
    return diff == 0;
}

static void token_generate(void)
{
    esp_fill_random(s_token, KB_WIFI_TOKEN_LEN);
    s_token_valid = true;
    ESP_LOGI(TAG, "Generated new WiFi token");
}

static void token_save(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed: %s", esp_err_to_name(err));
        return;
    }
    nvs_set_blob(handle, NVS_KEY_WIFI_TOKEN, s_token, KB_WIFI_TOKEN_LEN);
    nvs_set_u16(handle, NVS_KEY_WIFI_BOOTS, 0);  /* Reset boot counter */
    nvs_commit(handle);
    nvs_close(handle);
}

static void token_load(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        s_token_valid = false;
        return;
    }

    size_t len = KB_WIFI_TOKEN_LEN;
    err = nvs_get_blob(handle, NVS_KEY_WIFI_TOKEN, s_token, &len);
    if (err == ESP_OK && len == KB_WIFI_TOKEN_LEN && !token_is_zero(s_token)) {
        s_token_valid = true;
    } else {
        s_token_valid = false;
        memset(s_token, 0, KB_WIFI_TOKEN_LEN);
    }
    nvs_close(handle);
}

static void boot_count_increment(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return;

    uint16_t boots = 0;
    nvs_get_u16(handle, NVS_KEY_WIFI_BOOTS, &boots);
    boots++;

    if (boots >= KB_WIFI_BOOT_EXPIRE && s_token_valid) {
        ESP_LOGW(TAG, "WiFi token expired after %d boots, erasing credentials",
                 KB_WIFI_BOOT_EXPIRE);
        nvs_erase_key(handle, NVS_KEY_WIFI_TOKEN);
        nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
        nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
        nvs_set_u16(handle, NVS_KEY_WIFI_BOOTS, 0);
        s_token_valid = false;
        memset(s_token, 0, KB_WIFI_TOKEN_LEN);
    } else {
        nvs_set_u16(handle, NVS_KEY_WIFI_BOOTS, boots);
    }

    nvs_commit(handle);
    nvs_close(handle);

    if (s_token_valid) {
        ESP_LOGI(TAG, "WiFi boot count: %d/%d", boots, KB_WIFI_BOOT_EXPIRE);
    }
}

static void boot_count_reset(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return;
    nvs_set_u16(handle, NVS_KEY_WIFI_BOOTS, 0);
    nvs_commit(handle);
    nvs_close(handle);
}

/**
 * Validate an incoming token.
 * - If no token is stored yet (all zeros) and incoming is all zeros, generate a new one.
 * - Otherwise, constant-time compare.
 * Returns true if valid.
 */
static bool token_validate(const uint8_t *incoming)
{
    if (!s_token_valid && token_is_zero(incoming)) {
        /* First-time configuration: generate token */
        token_generate();
        token_save();
        return true;
    }
    if (!s_token_valid) {
        return false;
    }
    if (token_compare(s_token, incoming)) {
        boot_count_reset();
        return true;
    }
    return false;
}

static bool has_stored_credentials(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return false;

    char ssid[33];
    size_t len = sizeof(ssid);
    err = nvs_get_str(handle, NVS_KEY_WIFI_SSID, ssid, &len);
    nvs_close(handle);
    return (err == ESP_OK && len > 1);
}

/* ========================================================================= */
/*  Forward declarations                                                     */
/* ========================================================================= */

static void do_wifi_status(uint8_t transport);

/* ========================================================================= */
/*  WiFi Event Handler                                                       */
/* ========================================================================= */

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT) {
        switch (event_id) {
        case WIFI_EVENT_STA_START:
            ESP_LOGI(TAG, "WiFi STA started");
            break;
        case WIFI_EVENT_STA_CONNECTED: {
            wifi_event_sta_connected_t *ev = (wifi_event_sta_connected_t *)event_data;
            ESP_LOGI(TAG, "WiFi connected to %.*s", ev->ssid_len, ev->ssid);
            s_wifi_state = KB_WIFI_STATE_CONNECTED;
            break;
        }
        case WIFI_EVENT_STA_DISCONNECTED: {
            wifi_event_sta_disconnected_t *ev = (wifi_event_sta_disconnected_t *)event_data;
            ESP_LOGW(TAG, "WiFi disconnected, reason=%d", ev->reason);
            s_wifi_state = KB_WIFI_STATE_DISCONNECTED;
            memset(&s_ip_addr, 0, sizeof(s_ip_addr));
            break;
        }
        case WIFI_EVENT_AP_START:
            ESP_LOGI(TAG, "WiFi AP started");
            s_wifi_state = KB_WIFI_STATE_AP_ACTIVE;
            break;
        case WIFI_EVENT_AP_STOP:
            ESP_LOGI(TAG, "WiFi AP stopped");
            if (s_ap_mode) {
                s_wifi_state = KB_WIFI_STATE_DISCONNECTED;
            }
            break;
        case WIFI_EVENT_AP_STACONNECTED: {
            wifi_event_ap_staconnected_t *ev = (wifi_event_ap_staconnected_t *)event_data;
            ESP_LOGI(TAG, "AP: client connected, MAC=" MACSTR " aid=%d",
                     MAC2STR(ev->mac), ev->aid);
            /* Notify browser: event(1) mac(6) — IP comes later via DHCP */
            uint8_t payload[7];
            payload[0] = KB_WIFI_AP_CLIENT_CONNECTED;
            memcpy(&payload[1], ev->mac, 6);
            send_response(KB_PKT_WIFI_AP_EVENT, payload, sizeof(payload),
                          KB_TRANSPORT_BLE);
            break;
        }
        case WIFI_EVENT_AP_STADISCONNECTED: {
            wifi_event_ap_stadisconnected_t *ev = (wifi_event_ap_stadisconnected_t *)event_data;
            ESP_LOGI(TAG, "AP: client disconnected, MAC=" MACSTR, MAC2STR(ev->mac));
            uint8_t payload[7];
            payload[0] = KB_WIFI_AP_CLIENT_DISCONNECTED;
            memcpy(&payload[1], ev->mac, 6);
            send_response(KB_PKT_WIFI_AP_EVENT, payload, sizeof(payload),
                          KB_TRANSPORT_BLE);
            break;
        }
        default:
            break;
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)event_data;
        s_ip_addr = ev->ip_info.ip;
        s_wifi_state = KB_WIFI_STATE_CONNECTED;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&s_ip_addr));
    }
}

/* ========================================================================= */
/*  WiFi STA Init (on demand)                                                */
/* ========================================================================= */

static esp_err_t wifi_sta_init(void)
{
    if (s_wifi_initialized) return ESP_OK;

    ESP_LOGI(TAG, "Initializing WiFi STA");

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    s_sta_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    s_wifi_initialized = true;
    s_wifi_state = KB_WIFI_STATE_DISCONNECTED;
    ESP_LOGI(TAG, "WiFi STA initialized");
    return ESP_OK;
}

/* ========================================================================= */
/*  WiFi AP Init and Start                                                   */
/* ========================================================================= */

static esp_err_t wifi_ap_init(void)
{
    if (s_wifi_initialized) {
        /* Tear down STA mode first if it was initialized */
        esp_wifi_stop();
        if (s_sta_netif) {
            esp_netif_destroy_default_wifi(s_sta_netif);
            s_sta_netif = NULL;
        }
        s_wifi_initialized = false;
    }

    ESP_LOGI(TAG, "Initializing WiFi AP");

    if (!s_ap_netif) {
        esp_netif_init();
        esp_event_loop_create_default();
    }

    if (!s_ap_netif) {
        s_ap_netif = esp_netif_create_default_wifi_ap();
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));

    s_wifi_initialized = true;
    s_ap_mode = true;
    return ESP_OK;
}

static void do_wifi_ap_start(const char *ssid, const char *pass, uint8_t transport)
{
    esp_err_t err = wifi_ap_init();
    if (err != ESP_OK) {
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    wifi_config_t ap_cfg = {
        .ap = {
            .channel = 1,
            .max_connection = 4,
            .authmode = strlen(pass) > 0 ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN,
            .pmf_cfg = { .required = false },
        },
    };
    strncpy((char *)ap_cfg.ap.ssid, ssid, sizeof(ap_cfg.ap.ssid) - 1);
    ap_cfg.ap.ssid_len = strlen(ssid);
    if (strlen(pass) > 0) {
        strncpy((char *)ap_cfg.ap.password, pass, sizeof(ap_cfg.ap.password) - 1);
    }

    ESP_LOGI(TAG, "Starting AP: SSID=%s auth=%s", ssid,
             strlen(pass) > 0 ? "WPA2" : "open");

    err = esp_wifi_set_config(WIFI_IF_AP, &ap_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "AP set config failed: %s", esp_err_to_name(err));
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    err = esp_wifi_start();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "AP start failed: %s", esp_err_to_name(err));
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    /* AP is ready — get our IP (typically 192.168.4.1) */
    esp_netif_ip_info_t ip_info;
    if (esp_netif_get_ip_info(s_ap_netif, &ip_info) == ESP_OK) {
        s_ip_addr = ip_info.ip;
    }

    strncpy(s_connected_ssid, ssid, sizeof(s_connected_ssid) - 1);
    s_connected_ssid[sizeof(s_connected_ssid) - 1] = '\0';

    /* Save AP credentials to NVS */
    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_set_str(handle, NVS_KEY_WIFI_SSID, ssid);
        nvs_set_str(handle, NVS_KEY_WIFI_PASS, pass);
        nvs_commit(handle);
        nvs_close(handle);
    }

    /* Send token + status */
    uint8_t resp[1 + KB_WIFI_TOKEN_LEN + 1];
    resp[0] = 1; /* success */
    memcpy(&resp[1], s_token, KB_WIFI_TOKEN_LEN);
    resp[1 + KB_WIFI_TOKEN_LEN] = 1;
    send_response(KB_PKT_WIFI_TOKEN_RESPONSE, resp, sizeof(resp), transport);

    do_wifi_status(transport);

    ESP_LOGI(TAG, "AP started: SSID=%s IP=" IPSTR, ssid, IP2STR(&s_ip_addr));
}

/* ========================================================================= */
/*  WiFi Scan                                                                */
/* ========================================================================= */

static void do_wifi_scan(uint8_t transport)
{
    esp_err_t err = wifi_sta_init();
    if (err != ESP_OK) {
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    wifi_scan_config_t scan_cfg = {
        .ssid = NULL,
        .bssid = NULL,
        .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .scan_time = { .active = { .min = 100, .max = 300 } },
    };

    err = esp_wifi_scan_start(&scan_cfg, true /* block */);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi scan start failed: %s", esp_err_to_name(err));
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    if (ap_count > 20) ap_count = 20;  /* Limit results */

    wifi_ap_record_t *ap_list = NULL;
    if (ap_count > 0) {
        ap_list = calloc(ap_count, sizeof(wifi_ap_record_t));
        if (ap_list == NULL) {
            ESP_LOGE(TAG, "Failed to alloc scan results");
            esp_wifi_scan_get_ap_records(&ap_count, NULL);
            send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
            return;
        }
        esp_wifi_scan_get_ap_records(&ap_count, ap_list);
    }

    /* Send each AP as a WIFI_SCAN_RESULT packet */
    for (uint16_t i = 0; i < ap_count; i++) {
        uint8_t ssid_len = (uint8_t)strlen((char *)ap_list[i].ssid);
        /* Payload: rssi(1) auth(1) ssid_len(1) ssid(N) */
        uint8_t payload[3 + 32];
        uint8_t plen = 3 + ssid_len;
        if (plen > sizeof(payload)) plen = sizeof(payload);

        payload[0] = (uint8_t)(int8_t)ap_list[i].rssi;
        payload[1] = (uint8_t)ap_list[i].authmode;
        payload[2] = ssid_len;
        if (ssid_len > 0) {
            memcpy(&payload[3], ap_list[i].ssid, ssid_len);
        }

        uint8_t frame[KB_MAX_FRAME_SIZE];
        size_t frame_len = kb_pack_frame(frame, sizeof(frame),
                                         KB_PKT_WIFI_SCAN_RESULT, payload, plen);
        if (frame_len > 0) {
            send_ble_with_backpressure(frame, frame_len, transport);
            vTaskDelay(pdMS_TO_TICKS(2));
        }
    }

    free(ap_list);

    /* Send WIFI_SCAN_DONE: count(1) */
    uint8_t done_payload = (uint8_t)ap_count;
    send_response(KB_PKT_WIFI_SCAN_DONE, &done_payload, 1, transport);

    ESP_LOGI(TAG, "WiFi scan complete: %d APs found", ap_count);
}

/* ========================================================================= */
/*  WiFi Connect                                                             */
/* ========================================================================= */

static void do_wifi_connect(const char *ssid, const char *pass, uint8_t transport)
{
    esp_err_t err = wifi_sta_init();
    if (err != ESP_OK) {
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    /* Disconnect first if already connected */
    if (s_wifi_state == KB_WIFI_STATE_CONNECTED ||
        s_wifi_state == KB_WIFI_STATE_CONNECTING) {
        esp_wifi_disconnect();
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    s_wifi_state = KB_WIFI_STATE_CONNECTING;

    wifi_config_t wifi_cfg = { 0 };
    strncpy((char *)wifi_cfg.sta.ssid, ssid, sizeof(wifi_cfg.sta.ssid) - 1);
    strncpy((char *)wifi_cfg.sta.password, pass, sizeof(wifi_cfg.sta.password) - 1);

    ESP_LOGI(TAG, "Connecting to WiFi SSID: %s", ssid);

    err = esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi set config failed: %s", esp_err_to_name(err));
        s_wifi_state = KB_WIFI_STATE_ERROR;
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    err = esp_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi connect failed: %s", esp_err_to_name(err));
        s_wifi_state = KB_WIFI_STATE_ERROR;
        send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
        return;
    }

    /* Save credentials to NVS */
    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_set_str(handle, NVS_KEY_WIFI_SSID, ssid);
        nvs_set_str(handle, NVS_KEY_WIFI_PASS, pass);
        nvs_commit(handle);
        nvs_close(handle);
    }

    strncpy(s_connected_ssid, ssid, sizeof(s_connected_ssid) - 1);
    s_connected_ssid[sizeof(s_connected_ssid) - 1] = '\0';

    /* Wait for IP (up to 10 seconds) */
    for (int i = 0; i < 100; i++) {
        vTaskDelay(pdMS_TO_TICKS(100));
        if (s_wifi_state == KB_WIFI_STATE_CONNECTED && s_ip_addr.addr != 0) {
            break;
        }
        if (s_wifi_state == KB_WIFI_STATE_DISCONNECTED ||
            s_wifi_state == KB_WIFI_STATE_ERROR) {
            break;
        }
    }

    /* Send token response: the browser needs the token back */
    /* Payload: valid(1) token(16) has_creds(1) */
    uint8_t resp[1 + KB_WIFI_TOKEN_LEN + 1];
    resp[0] = (s_wifi_state == KB_WIFI_STATE_CONNECTED) ? 1 : 0;
    memcpy(&resp[1], s_token, KB_WIFI_TOKEN_LEN);
    resp[1 + KB_WIFI_TOKEN_LEN] = 1;
    send_response(KB_PKT_WIFI_TOKEN_RESPONSE, resp, sizeof(resp), transport);

    /* Also send status */
    do_wifi_status(transport);
}

static void do_wifi_disconnect(uint8_t transport)
{
    if (s_wifi_initialized) {
        esp_wifi_disconnect();
        esp_wifi_stop();
        esp_wifi_deinit();
        if (s_sta_netif) {
            esp_netif_destroy_default_wifi(s_sta_netif);
            s_sta_netif = NULL;
        }
        if (s_ap_netif) {
            esp_netif_destroy_default_wifi(s_ap_netif);
            s_ap_netif = NULL;
        }
        s_wifi_initialized = false;
        s_ap_mode = false;
        s_wifi_state = KB_WIFI_STATE_OFF;
        memset(&s_ip_addr, 0, sizeof(s_ip_addr));
        memset(s_connected_ssid, 0, sizeof(s_connected_ssid));
    }
    send_ack(KB_ACK_OK, transport);
    ESP_LOGI(TAG, "WiFi fully stopped");
}

static void do_wifi_status(uint8_t transport)
{
    /* Payload: state(1) ip(4) ssid_len(1) ssid(N) */
    uint8_t ssid_len = (uint8_t)strlen(s_connected_ssid);
    uint8_t payload[6 + 32];
    uint8_t plen = 6 + ssid_len;
    if (plen > sizeof(payload)) plen = sizeof(payload);

    payload[0] = s_wifi_state;
    memcpy(&payload[1], &s_ip_addr.addr, 4);
    payload[5] = ssid_len;
    if (ssid_len > 0) {
        memcpy(&payload[6], s_connected_ssid, ssid_len);
    }

    send_response(KB_PKT_WIFI_STATUS, payload, plen, transport);
}

static void do_wifi_forget(uint8_t transport)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
        nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
        nvs_erase_key(handle, NVS_KEY_WIFI_TOKEN);
        nvs_erase_key(handle, NVS_KEY_WIFI_BOOTS);
        nvs_commit(handle);
        nvs_close(handle);
    }

    /* Disconnect if connected */
    if (s_wifi_initialized) {
        esp_wifi_disconnect();
    }

    s_token_valid = false;
    memset(s_token, 0, KB_WIFI_TOKEN_LEN);
    s_wifi_state = s_wifi_initialized ? KB_WIFI_STATE_DISCONNECTED : KB_WIFI_STATE_OFF;
    memset(&s_ip_addr, 0, sizeof(s_ip_addr));
    memset(s_connected_ssid, 0, sizeof(s_connected_ssid));

    send_ack(KB_ACK_OK, transport);
    ESP_LOGI(TAG, "WiFi credentials and token erased");
}

/* ========================================================================= */
/*  HTTP Execution                                                           */
/* ========================================================================= */

static void do_http_execute(http_request_t *req, uint8_t transport)
{
    ESP_LOGI(TAG, "HTTP %s %s (body=%d bytes, headers=%d)",
             req->method == KB_HTTP_METHOD_GET ? "GET" :
             req->method == KB_HTTP_METHOD_POST ? "POST" :
             req->method == KB_HTTP_METHOD_PUT ? "PUT" :
             req->method == KB_HTTP_METHOD_DELETE ? "DELETE" :
             req->method == KB_HTTP_METHOD_PATCH ? "PATCH" : "?",
             req->url, (int)req->body_len, req->header_count);

    esp_http_client_method_t method;
    switch (req->method) {
    case KB_HTTP_METHOD_POST:   method = HTTP_METHOD_POST;   break;
    case KB_HTTP_METHOD_PUT:    method = HTTP_METHOD_PUT;     break;
    case KB_HTTP_METHOD_DELETE: method = HTTP_METHOD_DELETE;  break;
    case KB_HTTP_METHOD_PATCH:  method = HTTP_METHOD_PATCH;   break;
    default:                    method = HTTP_METHOD_GET;     break;
    }

    esp_http_client_config_t config = {
        .url = req->url,
        .method = method,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .disable_auto_redirect = false,
        .max_redirection_count = 5,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (client == NULL) {
        ESP_LOGE(TAG, "HTTP client init failed");
        uint8_t err_payload[] = { KB_HTTP_ERR_INTERNAL, 11,
            'i','n','i','t',' ','f','a','i','l','e','d' };
        send_response(KB_PKT_HTTP_ERROR, err_payload, sizeof(err_payload), transport);
        goto cleanup;
    }

    /* Set custom headers */
    for (int i = 0; i < req->header_count; i++) {
        esp_http_client_set_header(client, req->headers[i].key, req->headers[i].val);
    }

    /* Set body if present */
    if (req->body != NULL && req->body_len > 0) {
        esp_http_client_set_post_field(client, (const char *)req->body, (int)req->body_len);
    }

    esp_err_t err = esp_http_client_open(client, (req->body != NULL) ? (int)req->body_len : 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "HTTP open failed: %s", esp_err_to_name(err));
        uint8_t code = KB_HTTP_ERR_CONNECT;
        const char *msg = "connect failed";
        uint8_t msg_len = (uint8_t)strlen(msg);
        uint8_t err_payload[2 + 64];
        err_payload[0] = code;
        err_payload[1] = msg_len;
        memcpy(&err_payload[2], msg, msg_len);
        send_response(KB_PKT_HTTP_ERROR, err_payload, 2 + msg_len, transport);
        goto cleanup_client;
    }

    /* Write body for POST/PUT/PATCH */
    if (req->body != NULL && req->body_len > 0) {
        int written = esp_http_client_write(client, (const char *)req->body, (int)req->body_len);
        if (written < 0) {
            ESP_LOGE(TAG, "HTTP write body failed");
            uint8_t err_payload[] = { KB_HTTP_ERR_INTERNAL, 10,
                'w','r','i','t','e',' ','f','a','i','l' };
            send_response(KB_PKT_HTTP_ERROR, err_payload, sizeof(err_payload), transport);
            goto cleanup_client;
        }
    }

    int content_length = esp_http_client_fetch_headers(client);
    int status_code = esp_http_client_get_status_code(client);

    ESP_LOGI(TAG, "HTTP response: status=%d content_length=%d", status_code, content_length);

    /* Send HTTP_RESPONSE_STATUS: status(2,LE) content_length(4,LE) */
    {
        uint8_t status_payload[6];
        uint16_t status16 = (uint16_t)status_code;
        int32_t clen32 = (int32_t)content_length;
        memcpy(&status_payload[0], &status16, 2);
        memcpy(&status_payload[2], &clen32, 4);
        send_response(KB_PKT_HTTP_RESPONSE_STATUS, status_payload, 6, transport);
    }

    /* Stream response body in chunks */
    uint32_t total_read = 0;
    {
        uint8_t chunk_buf[HTTP_CHUNK_SIZE];
        int read_len;
        while (1) {
            read_len = esp_http_client_read(client, (char *)chunk_buf, HTTP_CHUNK_SIZE);
            if (read_len < 0) {
                ESP_LOGE(TAG, "HTTP read error");
                break;
            }
            if (read_len == 0) {
                /* Check if there is data remaining (chunked encoding) */
                if (esp_http_client_is_complete_data_received(client)) {
                    break;
                }
                /* For chunked transfers, 0 may be temporary */
                if (content_length < 0) {
                    /* Chunked: try again briefly */
                    vTaskDelay(pdMS_TO_TICKS(1));
                    read_len = esp_http_client_read(client, (char *)chunk_buf, HTTP_CHUNK_SIZE);
                    if (read_len <= 0) break;
                } else {
                    break;
                }
            }

            /* Send HTTP_RESPONSE_BODY chunk */
            uint8_t frame[KB_MAX_FRAME_SIZE];
            size_t frame_len = kb_pack_frame(frame, sizeof(frame),
                                             KB_PKT_HTTP_RESPONSE_BODY,
                                             chunk_buf, (uint8_t)read_len);
            if (frame_len > 0) {
                send_ble_with_backpressure(frame, frame_len, transport);
            }
            total_read += (uint32_t)read_len;
            vTaskDelay(pdMS_TO_TICKS(HTTP_CHUNK_DELAY_MS));
        }
    }

    /* Send HTTP_RESPONSE_DONE: total_bytes(4,LE) */
    {
        uint8_t done_payload[4];
        memcpy(done_payload, &total_read, 4);
        send_response(KB_PKT_HTTP_RESPONSE_DONE, done_payload, 4, transport);
    }

    ESP_LOGI(TAG, "HTTP complete: %lu bytes transferred", (unsigned long)total_read);

cleanup_client:
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
cleanup:
    /* Free body buffer */
    if (req->body != NULL) {
        free(req->body);
        req->body = NULL;
    }
    free(req);
    s_http_in_progress = false;
}

/* ========================================================================= */
/*  Worker Task                                                              */
/* ========================================================================= */

static void wifi_proxy_task(void *param)
{
    (void)param;
    wifi_cmd_t cmd;

    ESP_LOGI(TAG, "WiFi proxy task started");

    while (1) {
        if (xQueueReceive(s_cmd_queue, &cmd, portMAX_DELAY) == pdTRUE) {
            switch (cmd.type) {
            case CMD_SCAN:
                do_wifi_scan(cmd.transport);
                break;
            case CMD_CONNECT:
                do_wifi_connect(cmd.connect.ssid, cmd.connect.pass, cmd.transport);
                break;
            case CMD_DISCONNECT:
                do_wifi_disconnect(cmd.transport);
                break;
            case CMD_STATUS:
                do_wifi_status(cmd.transport);
                break;
            case CMD_HTTP_EXECUTE:
                do_http_execute(cmd.http_req, cmd.transport);
                break;
            case CMD_FORGET:
                do_wifi_forget(cmd.transport);
                break;
            case CMD_AP_START:
                do_wifi_ap_start(cmd.connect.ssid, cmd.connect.pass, cmd.transport);
                break;
            }
        }
    }
}

/* ========================================================================= */
/*  Packet Processing -- called from BLE/UART task context                   */
/* ========================================================================= */

static void reset_http_assembly(void)
{
    if (s_http_assembly.body != NULL) {
        free(s_http_assembly.body);
    }
    memset(&s_http_assembly, 0, sizeof(s_http_assembly));
}

void kb_wifi_process_packet(const kb_packet_t *pkt, uint8_t transport)
{
    wifi_cmd_t cmd;

    switch (pkt->type) {

    /* ---- WiFi Scan ---- */
    case KB_PKT_WIFI_SCAN_REQ: {
        if (pkt->length < KB_WIFI_TOKEN_LEN) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }
        cmd.type = CMD_SCAN;
        cmd.transport = transport;
        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
        }
        return;
    }

    /* ---- WiFi Connect ---- */
    case KB_PKT_WIFI_CONNECT_REQ: {
        /* Payload: token(16) ssid_len(1) ssid(N) pass_len(1) pass(M) */
        if (pkt->length < KB_WIFI_TOKEN_LEN + 2) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }

        const uint8_t *p = pkt->payload + KB_WIFI_TOKEN_LEN;
        uint8_t ssid_len = *p++;
        if (pkt->length < KB_WIFI_TOKEN_LEN + 2 + ssid_len) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *ssid = p;
        p += ssid_len;
        uint8_t pass_len = *p++;
        if (pkt->length < KB_WIFI_TOKEN_LEN + 2 + ssid_len + pass_len) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *pass = p;

        cmd.type = CMD_CONNECT;
        cmd.transport = transport;
        memset(cmd.connect.ssid, 0, sizeof(cmd.connect.ssid));
        memset(cmd.connect.pass, 0, sizeof(cmd.connect.pass));
        memcpy(cmd.connect.ssid, ssid, ssid_len < 32 ? ssid_len : 32);
        memcpy(cmd.connect.pass, pass, pass_len < 64 ? pass_len : 64);

        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
        }
        return;
    }

    /* ---- WiFi Disconnect ---- */
    case KB_PKT_WIFI_DISCONNECT_REQ: {
        if (pkt->length < KB_WIFI_TOKEN_LEN) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }
        cmd.type = CMD_DISCONNECT;
        cmd.transport = transport;
        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
        }
        return;
    }

    /* ---- WiFi Status (inline, no queue needed) ---- */
    case KB_PKT_WIFI_STATUS: {
        do_wifi_status(transport);
        return;
    }

    /* ---- Token Validate (inline) ---- */
    case KB_PKT_WIFI_TOKEN_VALIDATE: {
        if (pkt->length < KB_WIFI_TOKEN_LEN) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        bool valid = token_validate(pkt->payload);
        /* Payload: valid(1) token(16) has_creds(1) */
        uint8_t resp[1 + KB_WIFI_TOKEN_LEN + 1];
        resp[0] = valid ? 1 : 0;
        memcpy(&resp[1], s_token, KB_WIFI_TOKEN_LEN);
        resp[1 + KB_WIFI_TOKEN_LEN] = has_stored_credentials() ? 1 : 0;
        send_response(KB_PKT_WIFI_TOKEN_RESPONSE, resp, sizeof(resp), transport);
        return;
    }

    /* ---- WiFi Forget ---- */
    case KB_PKT_WIFI_FORGET_REQ: {
        if (pkt->length < KB_WIFI_TOKEN_LEN) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }
        cmd.type = CMD_FORGET;
        cmd.transport = transport;
        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
        }
        return;
    }

    /* ---- WiFi AP Start ---- */
    case KB_PKT_WIFI_AP_START: {
        /* Payload: token(16) ssid_len(1) ssid(N) pass_len(1) pass(M) */
        if (pkt->length < KB_WIFI_TOKEN_LEN + 2) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }
        const uint8_t *p = pkt->payload + KB_WIFI_TOKEN_LEN;
        uint8_t ssid_len = *p++;
        if (pkt->length < KB_WIFI_TOKEN_LEN + 2 + ssid_len) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *ssid = p;
        p += ssid_len;
        uint8_t pass_len = *p++;
        const uint8_t *pass = p;

        cmd.type = CMD_AP_START;
        cmd.transport = transport;
        memset(cmd.connect.ssid, 0, sizeof(cmd.connect.ssid));
        memset(cmd.connect.pass, 0, sizeof(cmd.connect.pass));
        memcpy(cmd.connect.ssid, ssid, ssid_len < 32 ? ssid_len : 32);
        if (pass_len > 0) {
            memcpy(cmd.connect.pass, pass, pass_len < 64 ? pass_len : 64);
        }
        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
        }
        return;
    }

    /* ---- HTTP Request Start ---- */
    case KB_PKT_HTTP_REQUEST: {
        /* Payload: token(16) method(1) url_len(2,LE) url(N<=109) */
        if (pkt->length < KB_WIFI_TOKEN_LEN + 3) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        if (!token_validate(pkt->payload)) {
            send_ack(KB_ACK_ERR_BAD_TOKEN, transport);
            return;
        }
        if (s_http_in_progress) {
            send_ack(KB_ACK_ERR_HTTP_IN_PROGRESS, transport);
            return;
        }
        if (s_wifi_state != KB_WIFI_STATE_CONNECTED &&
            s_wifi_state != KB_WIFI_STATE_AP_ACTIVE) {
            send_ack(KB_ACK_ERR_WIFI_FAIL, transport);
            return;
        }

        reset_http_assembly();

        const uint8_t *p = pkt->payload + KB_WIFI_TOKEN_LEN;
        s_http_assembly.method = *p++;
        uint16_t url_len;
        memcpy(&url_len, p, 2);
        p += 2;

        if (url_len > KB_WIFI_MAX_URL_LEN) {
            send_ack(KB_ACK_ERR_HTTP_TOO_LARGE, transport);
            return;
        }

        /* Copy URL bytes from this packet */
        uint8_t url_bytes_here = pkt->length - (KB_WIFI_TOKEN_LEN + 3);
        if (url_bytes_here > url_len) url_bytes_here = (uint8_t)url_len;
        memcpy(s_http_assembly.url, p, url_bytes_here);
        s_http_assembly.url_len = url_bytes_here;
        s_http_assembly.active = true;

        send_ack(KB_ACK_OK, transport);
        return;
    }

    /* ---- HTTP URL Continuation ---- */
    case KB_PKT_HTTP_REQUEST_URL_CONT: {
        if (!s_http_assembly.active) {
            send_ack(KB_ACK_ERR_UNKNOWN_TYPE, transport);
            return;
        }
        size_t remaining = KB_WIFI_MAX_URL_LEN - s_http_assembly.url_len;
        size_t copy_len = pkt->length;
        if (copy_len > remaining) copy_len = remaining;
        memcpy(s_http_assembly.url + s_http_assembly.url_len, pkt->payload, copy_len);
        s_http_assembly.url_len += copy_len;
        send_ack(KB_ACK_OK, transport);
        return;
    }

    /* ---- HTTP Header ---- */
    case KB_PKT_HTTP_REQUEST_HEADER: {
        if (!s_http_assembly.active) {
            send_ack(KB_ACK_ERR_UNKNOWN_TYPE, transport);
            return;
        }
        if (s_http_assembly.header_count >= MAX_HEADERS) {
            send_ack(KB_ACK_OK, transport);  /* silently ignore excess */
            return;
        }
        /* Payload: key_len(1) key(N) val_len(1) val(M) */
        if (pkt->length < 2) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *p = pkt->payload;
        uint8_t key_len = *p++;
        if (pkt->length < 2 + key_len) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *key = p;
        p += key_len;
        uint8_t val_len = *p++;
        if (pkt->length < 2 + key_len + val_len) {
            send_ack(KB_ACK_ERR_BAD_LENGTH, transport);
            return;
        }
        const uint8_t *val = p;

        http_header_t *hdr = &s_http_assembly.headers[s_http_assembly.header_count];
        size_t klen = key_len < (MAX_HEADER_KEY_LEN - 1) ? key_len : (MAX_HEADER_KEY_LEN - 1);
        size_t vlen = val_len < (MAX_HEADER_VAL_LEN - 1) ? val_len : (MAX_HEADER_VAL_LEN - 1);
        memcpy(hdr->key, key, klen);
        hdr->key[klen] = '\0';
        memcpy(hdr->val, val, vlen);
        hdr->val[vlen] = '\0';
        s_http_assembly.header_count++;

        send_ack(KB_ACK_OK, transport);
        return;
    }

    /* ---- HTTP Body Chunk ---- */
    case KB_PKT_HTTP_REQUEST_BODY: {
        if (!s_http_assembly.active) {
            send_ack(KB_ACK_ERR_UNKNOWN_TYPE, transport);
            return;
        }
        if (pkt->length == 0) {
            send_ack(KB_ACK_OK, transport);
            return;
        }

        size_t new_len = s_http_assembly.body_len + pkt->length;
        if (new_len > KB_WIFI_MAX_BODY_LEN) {
            send_ack(KB_ACK_ERR_HTTP_TOO_LARGE, transport);
            return;
        }

        /* Grow body buffer */
        if (s_http_assembly.body == NULL) {
            size_t cap = pkt->length < 256 ? 256 : pkt->length;
            if (cap > KB_WIFI_MAX_BODY_LEN) cap = KB_WIFI_MAX_BODY_LEN;
            s_http_assembly.body = malloc(cap);
            if (s_http_assembly.body == NULL) {
                ESP_LOGE(TAG, "Body malloc failed");
                send_ack(KB_ACK_ERR_HTTP_TOO_LARGE, transport);
                return;
            }
            s_http_assembly.body_cap = cap;
        }
        if (new_len > s_http_assembly.body_cap) {
            size_t new_cap = s_http_assembly.body_cap * 2;
            if (new_cap < new_len) new_cap = new_len;
            if (new_cap > KB_WIFI_MAX_BODY_LEN) new_cap = KB_WIFI_MAX_BODY_LEN;
            uint8_t *new_buf = realloc(s_http_assembly.body, new_cap);
            if (new_buf == NULL) {
                ESP_LOGE(TAG, "Body realloc failed");
                send_ack(KB_ACK_ERR_HTTP_TOO_LARGE, transport);
                return;
            }
            s_http_assembly.body = new_buf;
            s_http_assembly.body_cap = new_cap;
        }

        memcpy(s_http_assembly.body + s_http_assembly.body_len, pkt->payload, pkt->length);
        s_http_assembly.body_len = new_len;
        send_ack(KB_ACK_OK, transport);
        return;
    }

    /* ---- HTTP Request End → enqueue execution ---- */
    case KB_PKT_HTTP_REQUEST_END: {
        if (!s_http_assembly.active) {
            send_ack(KB_ACK_ERR_UNKNOWN_TYPE, transport);
            return;
        }

        /* Null-terminate URL */
        s_http_assembly.url[s_http_assembly.url_len] = '\0';
        s_http_assembly.active = false;

        /* Move assembled request to heap for the worker task */
        http_request_t *req = malloc(sizeof(http_request_t));
        if (req == NULL) {
            ESP_LOGE(TAG, "HTTP request malloc failed");
            reset_http_assembly();
            send_ack(KB_ACK_ERR_HTTP_TOO_LARGE, transport);
            return;
        }
        memcpy(req, &s_http_assembly, sizeof(http_request_t));
        /* Clear assembly without freeing body (ownership transferred to req) */
        s_http_assembly.body = NULL;
        memset(&s_http_assembly, 0, sizeof(s_http_assembly));

        s_http_in_progress = true;

        cmd.type = CMD_HTTP_EXECUTE;
        cmd.transport = transport;
        cmd.http_req = req;
        if (xQueueSend(s_cmd_queue, &cmd, 0) != pdTRUE) {
            ESP_LOGW(TAG, "WiFi command queue full");
            free(req->body);
            free(req);
            s_http_in_progress = false;
            send_ack(KB_ACK_ERR_HTTP_IN_PROGRESS, transport);
        } else {
            send_ack(KB_ACK_OK, transport);
        }
        return;
    }

    default:
        ESP_LOGW(TAG, "Unknown WiFi packet type: 0x%02x", pkt->type);
        send_ack(KB_ACK_ERR_UNKNOWN_TYPE, transport);
        return;
    }
}

/* ========================================================================= */
/*  Public API                                                               */
/* ========================================================================= */

esp_err_t kb_wifi_init(void)
{
    ESP_LOGI(TAG, "Initializing WiFi proxy");

    /* Load token from NVS and increment boot count */
    token_load();
    boot_count_increment();

    /* Create command queue */
    s_cmd_queue = xQueueCreate(CMD_QUEUE_SIZE, sizeof(wifi_cmd_t));
    if (s_cmd_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create command queue");
        return ESP_ERR_NO_MEM;
    }

    /* Create worker task */
    BaseType_t ret = xTaskCreate(wifi_proxy_task, "wifi_proxy",
                                 WIFI_TASK_STACK, NULL, WIFI_TASK_PRIO,
                                 &s_task_handle);
    if (ret != pdPASS) {
        ESP_LOGE(TAG, "Failed to create WiFi proxy task");
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "WiFi proxy initialized (token %s)",
             s_token_valid ? "loaded" : "none");
    return ESP_OK;
}

bool kb_wifi_is_connected(void)
{
    return (s_wifi_state == KB_WIFI_STATE_CONNECTED ||
            s_wifi_state == KB_WIFI_STATE_AP_ACTIVE) && s_ip_addr.addr != 0;
}
