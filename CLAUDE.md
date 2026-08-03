# CLAUDE.md

## Project Overview
Electron desktop app (Electron v13.1.7) that automatically cycles through YouTube playlists.

## Source Location
All application source lives in this directory (`resources/app/`), which is also the git repository root. The parent directory is an unpacked Electron distribution (binaries and locale data), not source.

## Work Rules
- If a requirement is unclear, ask the user instead of guessing.
- Aggressively reuse existing code and utilities. Never duplicate logic.
- When the cause of a problem is hard to identify, add diagnostic logs first and re-analyze from the logs the next time it occurs.

## Detailed Documentation

`Document.md` is the document that records the **intent**, **logic**, **system description**, and **important architectural decisions** of every file, class, and function.
Before starting work for the first time, you MUST read all of `Document.md` before doing any work.
Before starting work, you MUST read `## Document Editing Principles` and `## Programming Work Principles` in `Document.md` and MUST comply with their contents.
The document editing principles and programming work principles in that document are principles that MUST be followed, but everything else in it is absolutely NOT a description of constraints or specifications that the current code must satisfy. It is a document that reflects the content of the code so that AI can understand the code quickly, and it MUST always be updated to reflect the latest state of the code whenever the code changes.
