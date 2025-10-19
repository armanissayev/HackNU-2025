
  # Zaman Bank - HackNU 2025

  This is a code bundle for Zaman Bank - HackNU 2025. The original project is available at https://www.figma.com/design/Z0P0pOyLFQZdaFyujGKEKG/Zaman-Bank---HackNU-2025.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  
  ## RAG (Info.pdf) setup
  
  The app now stores embeddings in a persistent VectorDB in the browser (IndexedDB), not in a JSON file at runtime. A JSON index can still serve as a seed for first run.
  
  1. Place your Info.pdf at `src/data/Info.pdf` (already referenced by the build script).
  2. Build the vector index once:
     
    npm run rag:build
     
     This will generate `src/data/rag_index.json` used only for one-time migration.
  3. Start the app with `npm run dev`.
  4. On first load, the app will migrate `rag_index.json` into the VectorDB (IndexedDB). Subsequent runs use the VectorDB directly. You can check the browser console for logs prefixed with `[RAG]` (e.g., migration notice and selected sources).
  
  Notes:
  - If `rag_index.json` is missing but the VectorDB already exists, the app will work from the VectorDB.
  - You can clear the VectorDB by clearing the browser site data (IndexedDB) to force a fresh migration.
  - The embeddings and chat APIs are configured via `openai-hub.neuraldeep.tech` inside the code. Ensure network access is available.

  ## FAQ
  Q: Should I run the RAG build separately?
  A: Usually you only need to run it once. If this is your first time and the VectorDB (IndexedDB) is empty, run `npm run rag:build` to generate `src/data/rag_index.json`, then start the app and it will migrate the data into the VectorDB automatically. If the VectorDB is already populated in your browser, you don’t need to run it again. The app will also show a small notice in the chat if no VectorDB is detected to remind you to run the build once.
  

## RAG (Website) setup

In addition to Info.pdf, you can pre-build the VectorDB seed from the Zaman Bank website (Russian section) and merge it into the same index used for the first-run migration.

1. Run the web crawler + embedding builder:

   npm run rag:build:web

   What it does:
   - Crawls pages under https://www.zamanbank.kz/ru/ up to a conservative limit.
   - Extracts visible text, chunks it, and computes embeddings using the same OpenAI-compatible API.
   - Merges results into src/data/rag_index.json. On first app launch, this JSON will be migrated to the browser VectorDB (IndexedDB).

2. Start the app:

   npm run dev

Notes:
- If your VectorDB (IndexedDB) is already populated, the app will use that and won’t re-import rag_index.json. Clear the site data (IndexedDB) in your browser to force a fresh migration.
- You can run both PDF and Web builders; they will merge into the same rag_index.json.

## Quick start (TL;DR)

1. Prerequisites: Node.js 18+ and npm.
2. Install deps:

   npm i

3. (Optional, first time) Build RAG seeds:
   - From PDF: npm run rag:build
   - From Website: npm run rag:build:web
4. Run the app:

   npm run dev

5. Open http://localhost:5173 in your browser.

Troubleshooting:
- No answers from RAG? Clear browser site data (IndexedDB) to rebuild, then rerun the RAG build and reload the app.
- Network errors: the embeddings API is configured to openai-hub.neuraldeep.tech in the scripts; ensure your network allows access.
