# Agent Note: Interactive Harness tools

Status: implemented

English | [中文](2026-11-22-harness-tools.zh.md)

## Problem

Users working in Neurix need to open or resume an interactive Codex or Claude Code session from the current workspace and see whether the tool is installed in that execution environment.

## Decision

Use the existing user terminal for these sessions. The Web bundle declares the available programs and their start and resume arguments. Settings checks executables through the selected Session's subprocess provider, or the Host provider when no Session is open. The terminal controller resolves the configured launch again before starting it in the current directory. The browser selects a program and action without supplying an executable or arguments.

This extends [Web sidebar terminals](2026-09-09-web-sidebar-terminal.md) and follows [user-terminal permissions](../architecture/2026-09-16-user-terminal-permissions.md). Neurix owns the tab and PTY lifetime; each CLI owns authentication, its approvals, and session history.

## Alternatives considered

**Run through an LLM adapter or subagent.** A delegated or model-driven turn cannot expose the native sign-in, session picker, full interactive screen, or approval controls. Sending the conversation through that route also creates a second owner for the prompt and history.

**Manage installs automatically.** System, package-manager, and user installations have separate ownership and update rules. The settings page links to the vendor setup procedure so refreshing availability never changes any of them.

## Consequences

Closing the tab ends its process; restarting the Host never relaunches it. Resume uses the vendor's session picker, and Neurix does not capture the transcript as model context. The browser regression uses two isolated executable fixtures over the shipped settings, RPC, and PTY path.
