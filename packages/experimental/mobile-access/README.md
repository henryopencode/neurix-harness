---
description: "Run a self-hosted Neurix account and connect a phone to the same Desktop or Web Agent."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-mobile-access

English | [中文](README.zh.md)

## Summary

Create a Neurix account on a trusted computer, then sign in from a phone to continue its existing conversations. The computer runs the Agent and keeps its files, tools, and tasks; the phone displays the same Web application. Connect and disconnect explicitly from General settings. This package requires no iPhone automation runner and controls no other iOS apps.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load the bundle's [overlay](cordis.patch.yml) in an existing Web or Desktop profile. It replaces the sidebar's DeepSeek account UI with Neurix login and disables the Session feedback exporter. With the sidebar expanded, the launcher and its menu fill the sidebar's available inner width. The Feedback entry remains and reports that its channel is unavailable; it opens no external form. Model API-key configuration remains in Models. Unloading the bundle restores the underlying profile's contributions.

On the computer, open More → Sign in and create the first account with a 3–80 character name and a 12–128 character password. Then open Settings → General → Phone connection, select the intended network, and connect. On the same Wi-Fi, scan the QR code and sign in with this computer's Neurix account. The link contains no login credential. Safari can add the authenticated page to the Home Screen. Phone login persists in an HttpOnly cookie for the configured lifetime; a Host restart requires phone login again.

Disconnect phone closes that network listener and its sockets while local tasks continue. Signing out on the computer revokes every phone Peer. A phone's own sign-out revokes only that phone; existing Agent tasks remain owned by the computer. Keep the computer running and connected while a phone uses it. The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-mobile-access) owns listener, session, and login limits; activation itself opens no additional port.

### Internet access

Set `publicUrl` to the HTTPS origin of your reverse proxy and enable `autoConnect` to restore access when the Host starts or the computer account signs in. Internet mode binds the backend only to `127.0.0.1`, advertises the configured HTTPS address, admits its exact hostname, and marks login cookies Secure independently of proxy headers. It retains the computer's existing account, conversations, approval policy, and tools.

```yaml
- id: mobile-access
  config:
    port: 3081
    publicUrl: https://agent-connect.example.com/
    autoConnect: true
```

Run an outbound SSH reverse tunnel from the computer to a server you control, forwarding a server-loopback port to `127.0.0.1:3081`. The server's existing HTTPS proxy forwards HTTP and WebSocket requests to that port while preserving Host and Origin. Pin the SSH host key and use a dedicated key restricted to remote forwarding; supervise the connection with launchd on macOS or a service on Windows. No router port forwarding is required. The account and Agent continue running on the computer; the server forwards traffic. A disconnected or sleeping computer remains unavailable until it is online again.

Without `publicUrl`, the existing LAN mode remains available and requires explicit connection from General settings. Local-network HTTP is intended only for trusted private networks. The [public deployment guide](../../../docs/user/guide/public-deployments.md) owns the Host/Origin and reverse-proxy requirements.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The existing Host owns all Agent sessions, Remote methods, and event streams. An additional concrete-interface listener shares its HTTP routes, WebSocket upgrades, compression, and TLS configuration. Connection retains Host/Origin checks before consulting the registered account authentication provider. Each phone login has a distinct owner Peer; logout, expiry, disconnection, and unload revoke it. The network port and trust registration are withdrawn together.

The private credential provider stores one owner record with a salted scrypt-derived password key and the computer's signed-in state. Passwords and session tokens do not enter Session logs or model requests. Phone session tokens are random, retained only as hashes, authority-bound, bounded in count, and held in memory. Password checks are serialized with a finite admission queue and a failed-login cooldown. First-account creation is available only through the already authenticated local installation API; the public phone route accepts login only.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Connection](../../client/connection/README.md) — shared authenticated Remote transport.
- [Web server](../../host/webserver/README.md) — routing, listeners, and TLS.
- [Credentials](../../credentials/credentials-local/README.md) — private record persistence.

<a id="model-experience"></a>
## Model Experience

None, as account login and phone transport do not contribute model-visible context.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Account scope** — one owner account belongs to this Harness home. There is no central account directory, account recovery, or server-side roster of several computers. Creating the same name on another computer does not establish the same identity.
- **Deployment** — the reverse tunnel, public DNS, certificate renewal, and HTTPS proxy are deployment-owned. The plugin configures the local backend and public account authority; it does not obtain server credentials or wake a sleeping computer. LAN discovery lists IPv4 interfaces.
- **Mobile background** — iOS can suspend the page. The computer continues its tasks and the Web client recovers through its existing connection supervisor; this package adds no background execution or push notifications.

<a id="dev-note"></a>
### Dev Note

None.
