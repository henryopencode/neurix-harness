# Agent Note: Desktop voice controls retain one audio owner

Status: implemented

English | [中文](2026-11-16-desktop-voice-controls.zh.md)

## Problem

Minimized voice conversations need visible microphone and playback controls. Starting another browser audio lifetime in a native window would split permission, interruption, Session retention, and cleanup ownership.

## Decision

The primary renderer owns capture, synthesis playback, and the retained Session. The native window projects revisioned phase and mute state and routes fixed control commands to that owner. Its isolated document receives no transcript, Session title, or running-task inventory. IPC validates both the owning window and its top-frame origin.

The optional composer action replaces only an empty idle primary action. The composer owns Send, Stop, retries, and attachment admission. Preparation and input preferences live on the plugin page, and opening that page never starts capture or downloads.

Desktop minimization retains the primary renderer's audio lifetime and temporarily disables its background throttling. Audio release settles before the native control projection is withdrawn or Session retention is released. Browser-only hidden pages stop audio. Native rendering failure restores the main window and requests audio shutdown.

## Alternatives considered

A second recorder would accept independent input and require cross-window turn arbitration. Moving the audio owner when minimizing would interrupt browser permission and playback state. A phase-only native projection keeps the accepted Session input path and microphone owner unchanged.

## Consequences

Native UI availability is optional; old shells and ordinary browsers retain foreground-only audio. The native window is created lazily and has no model or Host connection. [Explicit recognition providers](2026-09-16-experimental-voice-input.md) still own recognition location and resource preparation.

Verification covers composer fallback, device permission cleanup, late native loading, sender rejection, microphone and speaker controls, revision ordering, and joined audio release. Platform installation and real microphone acceptance remain release-specific checks.
