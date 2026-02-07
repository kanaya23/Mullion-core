# Shopping Assistant Stack

Port of `To_port/ShoppingAssistant` with the full Gemini-driven Shopee workflow, deep scraper, and sidebar UI.

## Quick Start

1. **Create the profile (required)**
   ```bash
   node cli/create-profile.js shopping-assistant
   ```
   Log in to Shopee if you want personalized results, then keep the window open for the next step.

2. **Log in to Gemini Web (required for Web mode)**
   - In the same profile window, open `https://gemini.google.com/`.
   - Sign in and confirm you can send a prompt.
   - Close the window to save the profile.

3. **Configure the UI settings**
   - Open the Mullion dashboard and click **Open UI** for **shopping-assistant**.
   - In **Settings**:
     - **Native mode**: paste a Gemini API key and (optionally) a Serper API key.
     - **Web mode**: set the Gemini URL (default is fine) and select the Gemini mode.

## Notes

- **Native mode** uses the Gemini API + Serper for external validation.
- **Web mode** automates `gemini.google.com` and **requires the Gemini login step above**.
- The stack keeps conversation history and settings in `/storage/shopping-assistant.json`.

## UI Path

The UI lives at `netlify-site/stacks/shopping-assistant.html` and is linked via `stack.config.json` (`ui_path`).
