---
name: home-network-check
description: Check the user's own home network - which devices are connected, how the Wi-Fi is secured, what this PC exposes to the network - and walk through a router security checklist. Read-only and limited to the user's own network. Use when the user asks if their Wi-Fi or home network is secure, or wants to know what is connected.
---
# Home network check

Only the user's own network, only looking. No scanning of other networks, no attacks, no password recovery.

## This PC and the Wi-Fi

- Connection and addresses: `Get-NetIPConfiguration | Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer`
- Wi-Fi security of the current network: `netsh wlan show interfaces` and read the Authentication and Cipher lines. WPA3 or WPA2 with AES is good; WEP, WPA (version 1), TKIP or Open is weak.
- Never run `netsh wlan show profile ... key=clear` and never display Wi-Fi passwords.
- What this PC listens on: `Get-NetTCPConnection -State Listen | Sort-Object LocalPort -Unique | Select-Object LocalAddress, LocalPort, @{n='Program';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}`
  Ports bound to `127.0.0.1` are only reachable from this PC; `0.0.0.0` or `::` means the network can reach them, so check that the firewall is on.
- Network profile: `Get-NetConnectionProfile | Select-Object Name, NetworkCategory`. A home network can be Private; a café or hotel should be Public.

## Devices on the network

- Devices this PC has talked to recently: `Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.State -in 'Reachable','Stale' -and $_.IPAddress -notmatch '^(224|239|255)\.' } | Select-Object IPAddress, LinkLayerAddress, State`
- That list is incomplete. The router's device list (in its admin page) is the reliable one. Ask the user to open it in the browser and read it with them; let them sign in themselves.
- Help put a name on each device (phones, TV, console, printer, smart plugs). Flag the ones nobody recognizes.

## Router checklist (the user does it in the router's admin page)

1. The admin password is not the default printed on the sticker.
2. Firmware is up to date, or updates are automatic.
3. Wi-Fi uses WPA3 or WPA2-AES with a long passphrase; WPS is off.
4. Remote administration from the internet is off; UPnP is off unless a game or app needs it.
5. Smart-home and guest devices are on a separate guest network.
6. Unknown devices are removed and the Wi-Fi password changed if any were found.

## Report

What is good, what to fix (most important first), and step-by-step help for each fix. Change nothing on the router or the PC yourself unless the user asks.
