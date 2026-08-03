\ ElkWiFi application driver wrapper.
\
\ Copied from ../elkChat/src/elkwifi.asm.
\ The ElkWiFi service ROM exposes its ESP8266 driver through OSWORD &65.
\ The three-byte OSWORD parameter block contains the driver's A, X and Y.
\ See: https://github.com/hoglet67/ElkWiFi

OSWORD          = &FFF1
ELKWIFI_OSWORD  = &65

ELKWIFI_PAGE    = &FCFF
ELKWIFI_RAM     = &FD00

WIFI_CONNECT    = 8
WIFI_LAP        = 3
WIFI_JOIN       = 4
WIFI_CIPMUX     = 9
WIFI_SEND       = 13
WIFI_CLOSE      = 14
WIFI_IFCFG      = 18
WIFI_ENABLE     = 24

\ Function 13 expects X to point at five bytes in zero page:
\ address lo/hi, followed by a 24-bit byte count.
WIFI_SEND_CB    = &70

.wifi_call
    STA wifi_osword_block
    STX wifi_osword_block + 1
    STY wifi_osword_block + 2
    LDA #ELKWIFI_OSWORD
    LDX #LO(wifi_osword_block)
    LDY #HI(wifi_osword_block)
    JSR OSWORD
    RTS

.wifi_enable
    LDA #WIFI_ENABLE
    LDX #1
    LDY #0
    JSR wifi_call
    \ The service ROM keeps CIPMUX state in main RAM; initialize it explicitly
    \ so a cold Electron never mistakes our protocol string for a mux channel.
    LDX #LO(wifi_single_connection)
    LDY #HI(wifi_single_connection)
    TYA
    PHA
    TXA
    TAY
    PLA
    TAX
    LDA #WIFI_CIPMUX
    JSR wifi_call
    RTS

\ X/Y point to a connect block containing CR-terminated strings:
\ protocol, host and port. X is passed as the high byte by ElkWiFi.
.wifi_connect
    TYA
    PHA
    TXA
    TAY
    PLA
    TAX
    LDA #WIFI_CONNECT
    JSR wifi_call
    RTS

.wifi_lap
    LDA #WIFI_LAP
    LDX #0
    LDY #0
    JSR wifi_call
    RTS

\ X/Y point to two CR-terminated fields: SSID followed by password.
.wifi_join
    TYA
    PHA
    TXA
    TAY
    PLA
    TAX
    LDA #WIFI_JOIN
    JSR wifi_call
    RTS

\ X/Y point to bytes to transmit; A is their length (0..255).
.wifi_send
    STX WIFI_SEND_CB
    STY WIFI_SEND_CB + 1
    STA WIFI_SEND_CB + 2
    LDA #0
    STA WIFI_SEND_CB + 3
    STA WIFI_SEND_CB + 4

    LDA #WIFI_SEND
    LDX #WIFI_SEND_CB
    LDY #0
    JSR wifi_call
    RTS

.wifi_close
    LDA #WIFI_CLOSE
    LDX #0
    LDY #0
    JSR wifi_call
    RTS

.wifi_ifcfg
    LDA #WIFI_IFCFG
    LDX #0
    LDY #0
    JSR wifi_call
    RTS

.wifi_osword_block
    EQUB 0, 0, 0

.wifi_single_connection
    EQUS "0", 13
