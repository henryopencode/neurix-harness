---
description: "Connect a phone to the same Desktop or Web Agent with a private link and QR code."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-mobile-access

English | [中文](README.zh.md)

## Summary

Continue this computer's Agent conversations from your phone using a private link or QR code, without creating an account. Open the Phone connection plugin under Extension tools to enable access, copy the link, or update it. The computer retains its files, tools, and tasks and must stay running and online. This package requires no iPhone automation runner and controls no other iOS apps.

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

Enable the bundle in Plugins → Extension tools → Phone connection, or load its [overlay](cordis.patch.yml) in an existing Web or Desktop profile. The bundle removes the sidebar's DeepSeek account UI and disables the Session feedback exporter. The bottom Settings gear opens the local Settings and Feedback menu; Feedback opens no external form. Model API-key configuration remains in Models. Unloading the bundle restores the underlying profile's contributions. The panel and its messages follow the interface language.

Open the plugin's configuration page and enable the connection. Scan its QR code or copy the complete link to your phone. LAN mode requires the same network; a configured internet endpoint works on cellular data or any Wi-Fi. The link contains a 256-bit random bearer secret in its fragment, which the browser exchanges in a same-origin request body for an HttpOnly session cookie, then removes from browser history. Anyone holding the complete link can control the Agent; keep it private.

Reopening the panel, reconnecting, and restarting the Host retain the saved secret. Update link generates a new secret and revokes every previous phone cookie and live Peer. Disable connection revokes phones and closes the listener while local Agent tasks continue. Enabling access again retains the saved secret. Browser sessions expire independently; reopening the saved link reconnects. A phone can disconnect itself but cannot read or change the computer's link through the plugin API.

### Internet access

Set `publicUrl` to the HTTPS origin of your reverse proxy and enable `autoConnect` to restore access when the Host starts, respecting an explicit saved disable. Internet mode binds the backend only to `127.0.0.1`, advertises the configured HTTPS address, admits its exact hostname, and marks phone cookies Secure independently of proxy headers. It retains the computer's conversations, approval policy, and tools.

```yaml
- id: mobile-access
  config:
    port: 3081
    publicUrl: https://agent-connect.example.com/
    autoConnect: true
```

Run an outbound SSH reverse tunnel from the computer to a server you control, forwarding a server-loopback port to `127.0.0.1:3081`. The server's existing HTTPS proxy forwards HTTP and WebSocket requests to that port while preserving Host and Origin. Pin the SSH host key and use a dedicated key restricted to remote forwarding; supervise the connection with launchd on macOS or a service on Windows. No router port forwarding is required. The Agent continues running on the computer; the server forwards traffic. A disconnected or sleeping computer remains unavailable until it is online again.

Without `publicUrl`, the existing LAN mode remains available and requires explicit connection from the plugin page. Local-network HTTP is intended only for trusted private networks. The [public deployment guide](../../../docs/user/guide/public-deployments.md) owns the Host/Origin and reverse-proxy requirements.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The existing Host owns all Agent sessions, Remote methods, and event streams. A secondary listener shares its HTTP routes, WebSocket upgrades, compression, and TLS configuration. Connection checks Host and Origin before consulting the link-session authentication provider. Each phone receives a distinct owner Peer; disconnection, expiry, link rotation, and unload revoke it. The network listener and authority registration are withdrawn together.

The private credential provider stores the link secret and access switch. Activation removes the plugin's retired Neurix owner-account record while preserving other credentials. Secrets do not enter Session logs or model requests. Browser session tokens are random, stored only as hashes in memory, bound to an exact authority, and bounded in count and duration. Listener changes and link updates are serialized; failed persistence preserves the previously published link.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Connection](../../client/connection/README.md) — shared authenticated Remote transport.
- [Web server](../../host/webserver/README.md) — routing, listeners, and TLS.
- [Credentials](../../credentials/credentials-local/README.md) — private record persistence.

<a id="model-experience"></a>
## Model Experience

None, as phone connection and transport do not contribute model-visible context.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Link scope** — one connection secret belongs to this Harness home. This package provides no central device directory, account system, or link recovery service.
- **Deployment** — the reverse tunnel, public DNS, certificate renewal, and HTTPS proxy are deployment-owned. The plugin configures the local backend and public connection authority; it does not obtain server credentials or wake a sleeping computer. LAN discovery lists IPv4 interfaces.
- **Mobile background** — iOS can suspend the page. The computer continues its tasks and the Web client recovers through its existing connection supervisor; this package adds no background execution or push notifications.

<a id="dev-note"></a>
### Dev Note

None.
