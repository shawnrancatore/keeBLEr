// SPDX-License-Identifier: MIT
/*
 * Keebler Serial Transport Implementation
 *
 * UART-based bidirectional packet transport.
 * Runs a background FreeRTOS task that reads UART data and feeds the
 * protocol frame parser. Complete packets are dispatched via callback.
 */

#include "serial_transport.h"
#include "board_config.h"

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"

static const char *TAG = "serial_transport";

/* RX task parameters */
#define UART_RX_TASK_STACK  4096
#define UART_RX_TASK_PRIO   5
#define UART_RX_BUF_SIZE    256

static serial_transport_rx_cb_t s_rx_callback = NULL;
static void *s_rx_user_ctx = NULL;
static kb_parser_t s_uart_parser;
static bool s_initialized = false;

/* ========================================================================= */
/*  UART RX Task                                                             */
/* ========================================================================= */

static void uart_rx_task(void *param)
{
    (void)param;
    uint8_t rx_buf[UART_RX_BUF_SIZE];

    ESP_LOGI(TAG, "UART RX task started on UART%d", BOARD_UART_NUM);

    while (1) {
        int len = uart_read_bytes(BOARD_UART_NUM, rx_buf, sizeof(rx_buf),
                                  pdMS_TO_TICKS(20));
        if (len <= 0) {
            continue;
        }

        ESP_LOGD(TAG, "UART RX %d bytes", len);

        /* Feed each byte into the frame parser */
        for (int i = 0; i < len; i++) {
            kb_parse_result_t result = kb_parser_feed(&s_uart_parser, rx_buf[i]);
            switch (result) {
            case KB_PARSE_OK:
                ESP_LOGD(TAG, "UART parsed packet type=0x%02x len=%d",
                         s_uart_parser.packet.type, s_uart_parser.packet.length);
                if (s_rx_callback) {
                    s_rx_callback(&s_uart_parser.packet, s_rx_user_ctx);
                }
                break;
            case KB_PARSE_ERR_CRC:
                ESP_LOGW(TAG, "UART frame CRC error");
                break;
            case KB_PARSE_ERR_OVERFLOW:
                ESP_LOGW(TAG, "UART frame overflow");
                break;
            case KB_PARSE_INCOMPLETE:
                break;
            }
        }
    }
}

/* ========================================================================= */
/*  Public API                                                               */
/* ========================================================================= */

esp_err_t serial_transport_init(void)
{
    ESP_LOGI(TAG, "Initializing serial transport on UART%d (TX=%d, RX=%d, %d baud)",
             BOARD_UART_NUM, BOARD_UART_TX_PIN, BOARD_UART_RX_PIN, BOARD_UART_BAUD);

    kb_parser_init(&s_uart_parser);

    uart_config_t uart_config = {
        .baud_rate = BOARD_UART_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    esp_err_t ret;

    ret = uart_driver_install(BOARD_UART_NUM, BOARD_UART_BUF_SIZE * 2,
                               BOARD_UART_BUF_SIZE * 2, 0, NULL, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART driver install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = uart_param_config(BOARD_UART_NUM, &uart_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART param config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = uart_set_pin(BOARD_UART_NUM, BOARD_UART_TX_PIN, BOARD_UART_RX_PIN,
                        UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART set pin failed: %s", esp_err_to_name(ret));
        return ret;
    }

    /* Start RX task */
    BaseType_t task_ret = xTaskCreate(uart_rx_task, "uart_rx",
                                       UART_RX_TASK_STACK, NULL,
                                       UART_RX_TASK_PRIO, NULL);
    if (task_ret != pdPASS) {
        ESP_LOGE(TAG, "Failed to create UART RX task");
        return ESP_ERR_NO_MEM;
    }

    s_initialized = true;
    ESP_LOGI(TAG, "Serial transport initialized");
    return ESP_OK;
}

esp_err_t serial_transport_send(const uint8_t *data, size_t len)
{
    if (data == NULL || len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    int written = uart_write_bytes(BOARD_UART_NUM, data, len);
    if (written < 0) {
        ESP_LOGE(TAG, "UART write failed");
        return ESP_FAIL;
    }

    ESP_LOGD(TAG, "UART TX %d bytes", written);
    return ESP_OK;
}

esp_err_t serial_transport_send_packet(uint8_t type, const uint8_t *payload, uint8_t payload_len)
{
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t frame_len = kb_pack_frame(frame, sizeof(frame), type, payload, payload_len);
    if (frame_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    return serial_transport_send(frame, frame_len);
}

void serial_transport_set_rx_callback(serial_transport_rx_cb_t cb, void *user_ctx)
{
    s_rx_callback = cb;
    s_rx_user_ctx = user_ctx;
}
