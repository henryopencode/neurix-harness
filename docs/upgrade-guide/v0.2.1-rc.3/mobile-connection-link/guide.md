---
kind: upgrade-guide
description: "Phone connection replaces the experimental Neurix account with a private connection link."
---

# Phone connection uses a private link

English | [中文](guide.zh.md)

## Change

The experimental mobile-access bundle removes Neurix account registration, sign-in, and its `neurixAccount` Remote namespace. Its configuration moves from General settings to Plugins → Extension tools → Phone connection. Existing phone cookies are revoked. The plugin removes its retired `neurix-account/owner` credential record while retaining model-provider credentials and Agent conversations.

## Migration

1. Remove `loginFailedAttempts`, `loginCooldownMs`, and `maxPendingLogins` from any `mobile-access` configuration. Retain `port`, `publicUrl`, `autoConnect`, `sessionMaxAgeMs`, and `maxPhoneSessions` as needed.
2. Open Phone connection on the computer and enable access. Copy the complete link or scan its QR code. The phone opens the same Agent without an account password.
3. Save the private link. Its random secret persists across restarts and reconnections. Update link replaces it and disconnects every phone; disable connection preserves the secret but stops remote access.
4. Replace custom account API consumers with `mobileAccess.describe`, `watch`, `open`, `close`, and `regenerate`. A phone disconnects itself through `POST /neurix/disconnect`; only the local computer browser may manage connection links.
