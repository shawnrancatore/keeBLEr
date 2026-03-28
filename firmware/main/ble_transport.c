// SPDX-License-Identifier: MIT
/*
 * Keebler BLE Transport Implementation
 *
 * NimBLE GATT peripheral with custom service for bidirectional packet exchange.
 *
 * Service UUID:  4b454500-424c-4500-0000-000000000000
 * RX Char UUID:  4b454500-424c-4500-0000-000000000001  (write, write-no-response)
 * TX Char UUID:  4b454500-424c-4500-0000-000000000002  (notify)
 */

#include "ble_transport.h"
#include "board_config.h"

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* NimBLE includes */
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "host/ble_uuid.h"
#include "host/ble_store.h"

static const char *TAG = "ble_transport";

/* ========================================================================= */
/*  UUIDs                                                                    */
/* ========================================================================= */

/* Service: 4b454500-424c-4500-0000-000000000000 */
static const ble_uuid128_t s_svc_uuid =
    BLE_UUID128_INIT(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                     0x00, 0x45, 0x4c, 0x42, 0x00, 0x45, 0x45, 0x4b);

/* RX Characteristic: 4b454500-424c-4500-0000-000000000001 (write) */
static const ble_uuid128_t s_rx_chr_uuid =
    BLE_UUID128_INIT(0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                     0x00, 0x45, 0x4c, 0x42, 0x00, 0x45, 0x45, 0x4b);

/* TX Characteristic: 4b454500-424c-4500-0000-000000000002 (notify) */
static const ble_uuid128_t s_tx_chr_uuid =
    BLE_UUID128_INIT(0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                     0x00, 0x45, 0x4c, 0x42, 0x00, 0x45, 0x45, 0x4b);

/* ========================================================================= */
/*  State                                                                    */
/* ========================================================================= */

static uint16_t s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_tx_chr_val_handle;
static bool s_notify_enabled = false;
static uint8_t s_own_addr_type;

static kb_ble_rx_cb_t s_rx_callback = NULL;
static void *s_rx_user_ctx = NULL;

static kb_parser_t s_ble_parser;

/* Forward declarations */
static int ble_gap_event_cb(struct ble_gap_event *event, void *arg);
static void ble_on_sync(void);
static void ble_on_reset(int reason);
static void ble_advertise(void);

void ble_store_config_init(void);

/* ========================================================================= */
/*  GATT Access Callback                                                     */
/* ========================================================================= */

static int gatt_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)arg;

    switch (ctxt->op) {
    case BLE_GATT_ACCESS_OP_WRITE_CHR: {
        /* Data written to RX characteristic - feed into protocol parser */
        uint16_t om_len = OS_MBUF_PKTLEN(ctxt->om);
        uint8_t buf[KB_MAX_FRAME_SIZE];

        if (om_len > sizeof(buf)) {
            ESP_LOGW(TAG, "BLE write too large: %d bytes", om_len);
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }

        uint16_t copied = 0;
        int rc = ble_hs_mbuf_to_flat(ctxt->om, buf, sizeof(buf), &copied);
        if (rc != 0) {
            ESP_LOGE(TAG, "Failed to flatten mbuf: %d", rc);
            return BLE_ATT_ERR_UNLIKELY;
        }

        ESP_LOGD(TAG, "BLE RX %d bytes", copied);

        /* Feed each byte into the frame parser */
        for (uint16_t i = 0; i < copied; i++) {
            kb_parse_result_t result = kb_parser_feed(&s_ble_parser, buf[i]);
            switch (result) {
            case KB_PARSE_OK:
                ESP_LOGD(TAG, "BLE parsed packet type=0x%02x len=%d",
                         s_ble_parser.packet.type, s_ble_parser.packet.length);
                if (s_rx_callback) {
                    s_rx_callback(&s_ble_parser.packet, s_rx_user_ctx);
                }
                break;
            case KB_PARSE_ERR_CRC:
                ESP_LOGW(TAG, "BLE frame CRC error");
                break;
            case KB_PARSE_ERR_OVERFLOW:
                ESP_LOGW(TAG, "BLE frame overflow");
                break;
            case KB_PARSE_INCOMPLETE:
                break;
            }
        }
        return 0;
    }

    case BLE_GATT_ACCESS_OP_READ_CHR:
        /* TX characteristic read - return empty */
        return 0;

    default:
        return BLE_ATT_ERR_UNLIKELY;
    }
}

/* ========================================================================= */
/*  GATT Service Definition                                                  */
/* ========================================================================= */

static const struct ble_gatt_svc_def s_gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                /* RX Characteristic (client writes to this) */
                .uuid = &s_rx_chr_uuid.u,
                .access_cb = gatt_access_cb,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                /* TX Characteristic (server notifies through this) */
                .uuid = &s_tx_chr_uuid.u,
                .access_cb = gatt_access_cb,
                .val_handle = &s_tx_chr_val_handle,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
            },
            { 0 }, /* Terminator */
        },
    },
    { 0 }, /* Terminator */
};

/* ========================================================================= */
/*  GATT Registration Callback                                               */
/* ========================================================================= */

static void gatt_register_cb(struct ble_gatt_register_ctxt *ctxt, void *arg)
{
    (void)arg;
    char buf[BLE_UUID_STR_LEN];

    switch (ctxt->op) {
    case BLE_GATT_REGISTER_OP_SVC:
        ESP_LOGI(TAG, "Registered service %s handle=%d",
                 ble_uuid_to_str(ctxt->svc.svc_def->uuid, buf),
                 ctxt->svc.handle);
        break;
    case BLE_GATT_REGISTER_OP_CHR:
        ESP_LOGI(TAG, "Registered characteristic %s def_handle=%d val_handle=%d",
                 ble_uuid_to_str(ctxt->chr.chr_def->uuid, buf),
                 ctxt->chr.def_handle, ctxt->chr.val_handle);
        break;
    case BLE_GATT_REGISTER_OP_DSC:
        ESP_LOGD(TAG, "Registered descriptor %s handle=%d",
                 ble_uuid_to_str(ctxt->dsc.dsc_def->uuid, buf),
                 ctxt->dsc.handle);
        break;
    default:
        break;
    }
}

/* ========================================================================= */
/*  GAP Advertising                                                          */
/* ========================================================================= */

static void ble_advertise(void)
{
    struct ble_gap_adv_params adv_params;
    struct ble_hs_adv_fields fields;
    int rc;

    memset(&fields, 0, sizeof(fields));

    /* Flags: general discoverable, BLE-only */
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;

    /* TX power */
    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl = BLE_HS_ADV_TX_PWR_LVL_AUTO;

    /* Device name */
    const char *name = ble_svc_gap_device_name();
    fields.name = (uint8_t *)name;
    fields.name_len = strlen(name);
    fields.name_is_complete = 1;

    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to set adv fields: %d", rc);
        return;
    }

    /* Set scan response with 128-bit service UUID */
    struct ble_hs_adv_fields rsp_fields;
    memset(&rsp_fields, 0, sizeof(rsp_fields));
    rsp_fields.uuids128 = (ble_uuid128_t[]){ s_svc_uuid };
    rsp_fields.num_uuids128 = 1;
    rsp_fields.uuids128_is_complete = 1;

    rc = ble_gap_adv_rsp_set_fields(&rsp_fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to set scan response fields: %d", rc);
        /* Non-fatal, continue advertising without scan response */
    }

    /* Start advertising: connectable, general discoverable */
    memset(&adv_params, 0, sizeof(adv_params));
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;

    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER,
                            &adv_params, ble_gap_event_cb, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to start advertising: %d", rc);
        return;
    }

    ESP_LOGI(TAG, "Advertising started as \"%s\"", name);
}

/* ========================================================================= */
/*  GAP Event Handler                                                        */
/* ========================================================================= */

static int ble_gap_event_cb(struct ble_gap_event *event, void *arg)
{
    (void)arg;

    switch (event->type) {
    case BLE_GAP_EVENT_LINK_ESTAB:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "BLE connected, conn_handle=%d", s_conn_handle);

            /* Request low-latency connection parameters for HID responsiveness:
             * interval 7.5–15ms, latency 0, timeout 2s */
            struct ble_gap_upd_params conn_params = {
                .itvl_min = 6,      /* 7.5ms (units of 1.25ms) */
                .itvl_max = 12,     /* 15ms */
                .latency = 0,
                .supervision_timeout = 200, /* 2s (units of 10ms) */
                .min_ce_len = 0,
                .max_ce_len = 0,
            };
            ble_gap_update_params(s_conn_handle, &conn_params);
        } else {
            ESP_LOGW(TAG, "BLE connection failed, status=%d", event->connect.status);
            s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
            ble_advertise();
        }
        return 0;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "BLE disconnected, reason=%d", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_notify_enabled = false;
        /* Reset parser state on disconnect */
        kb_parser_init(&s_ble_parser);
        /* Resume advertising */
        ble_advertise();
        return 0;

    case BLE_GAP_EVENT_CONN_UPDATE:
        ESP_LOGD(TAG, "Connection updated, status=%d", event->conn_update.status);
        return 0;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        ESP_LOGD(TAG, "Advertising complete, reason=%d", event->adv_complete.reason);
        ble_advertise();
        return 0;

    case BLE_GAP_EVENT_SUBSCRIBE:
        ESP_LOGI(TAG, "Subscribe event: conn_handle=%d attr_handle=%d "
                 "cur_notify=%d cur_indicate=%d",
                 event->subscribe.conn_handle,
                 event->subscribe.attr_handle,
                 event->subscribe.cur_notify,
                 event->subscribe.cur_indicate);
        if (event->subscribe.attr_handle == s_tx_chr_val_handle) {
            s_notify_enabled = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "TX notifications %s",
                     s_notify_enabled ? "enabled" : "disabled");
        }
        return 0;

    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU updated: conn_handle=%d mtu=%d",
                 event->mtu.conn_handle, event->mtu.value);
        return 0;

    case BLE_GAP_EVENT_REPEAT_PAIRING: {
        /* Delete old bond and retry */
        struct ble_gap_conn_desc desc;
        int rc = ble_gap_conn_find(event->repeat_pairing.conn_handle, &desc);
        if (rc == 0) {
            ble_store_util_delete_peer(&desc.peer_id_addr);
        }
        return BLE_GAP_REPEAT_PAIRING_RETRY;
    }

    default:
        return 0;
    }
}

/* ========================================================================= */
/*  NimBLE Host Callbacks                                                    */
/* ========================================================================= */

static void ble_on_sync(void)
{
    int rc;

    rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to ensure address: %d", rc);
        return;
    }

    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to infer address type: %d", rc);
        return;
    }

    uint8_t addr[6] = {0};
    ble_hs_id_copy_addr(s_own_addr_type, addr, NULL);
    ESP_LOGI(TAG, "BLE address: %02x:%02x:%02x:%02x:%02x:%02x",
             addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]);

    ble_advertise();
}

static void ble_on_reset(int reason)
{
    ESP_LOGW(TAG, "NimBLE host reset, reason=%d", reason);
}

/* ========================================================================= */
/*  NimBLE Host Task                                                         */
/* ========================================================================= */

static void ble_host_task(void *param)
{
    (void)param;
    ESP_LOGI(TAG, "NimBLE host task started");
    nimble_port_run();
    nimble_port_freertos_deinit();
}

/* ========================================================================= */
/*  GATT Server Init                                                         */
/* ========================================================================= */

static int gatt_svr_init(void)
{
    int rc;

    ble_svc_gap_init();
    ble_svc_gatt_init();

    rc = ble_gatts_count_cfg(s_gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "GATT count cfg failed: %d", rc);
        return rc;
    }

    rc = ble_gatts_add_svcs(s_gatt_svcs);
    if (rc != 0) {
        ESP_LOGE(TAG, "GATT add svcs failed: %d", rc);
        return rc;
    }

    return 0;
}

/* ========================================================================= */
/*  Public API                                                               */
/* ========================================================================= */

esp_err_t kb_ble_init(void)
{
    int rc;

    ESP_LOGI(TAG, "Initializing BLE transport");

    /* Initialize frame parser */
    kb_parser_init(&s_ble_parser);

    /* Initialize NimBLE port */
    rc = nimble_port_init();
    if (rc != ESP_OK) {
        ESP_LOGE(TAG, "NimBLE port init failed: %d", rc);
        return ESP_FAIL;
    }

    /* Configure NimBLE host */
    ble_hs_cfg.reset_cb = ble_on_reset;
    ble_hs_cfg.sync_cb = ble_on_sync;
    ble_hs_cfg.gatts_register_cb = gatt_register_cb;
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC;

    /* Initialize GATT server */
    rc = gatt_svr_init();
    if (rc != 0) {
        ESP_LOGE(TAG, "GATT server init failed: %d", rc);
        return ESP_FAIL;
    }

    /* Set device name with version */
    char ble_name[32];
    snprintf(ble_name, sizeof(ble_name), "keebler %s", KB_VERSION_STRING);
    rc = ble_svc_gap_device_name_set(ble_name);
    if (rc != 0) {
        ESP_LOGE(TAG, "Failed to set device name: %d", rc);
        return ESP_FAIL;
    }

    /* Initialize NVS-based bonding store */
    ble_store_config_init();

    /* Start NimBLE host task */
    nimble_port_freertos_init(ble_host_task);

    ESP_LOGI(TAG, "BLE transport initialized");
    return ESP_OK;
}

esp_err_t kb_ble_send(const uint8_t *data, size_t len)
{
    if (data == NULL || len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        ESP_LOGD(TAG, "No BLE connection, cannot send");
        return ESP_ERR_INVALID_STATE;
    }

    if (!s_notify_enabled) {
        ESP_LOGD(TAG, "Notifications not enabled, cannot send");
        return ESP_ERR_INVALID_STATE;
    }

    struct os_mbuf *om = ble_hs_mbuf_from_flat(data, len);
    if (om == NULL) {
        ESP_LOGE(TAG, "Failed to allocate mbuf for TX");
        return ESP_ERR_NO_MEM;
    }

    int rc = ble_gatts_notify_custom(s_conn_handle, s_tx_chr_val_handle, om);
    if (rc != 0) {
        ESP_LOGE(TAG, "BLE notify failed: %d", rc);
        return ESP_FAIL;
    }

    ESP_LOGD(TAG, "BLE TX %d bytes", (int)len);
    return ESP_OK;
}

esp_err_t kb_ble_send_packet(uint8_t type, const uint8_t *payload, uint8_t payload_len)
{
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t frame_len = kb_pack_frame(frame, sizeof(frame), type, payload, payload_len);
    if (frame_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return kb_ble_send(frame, frame_len);
}

void kb_ble_set_rx_callback(kb_ble_rx_cb_t cb, void *user_ctx)
{
    s_rx_callback = cb;
    s_rx_user_ctx = user_ctx;
}

bool kb_ble_is_connected(void)
{
    return s_conn_handle != BLE_HS_CONN_HANDLE_NONE;
}
