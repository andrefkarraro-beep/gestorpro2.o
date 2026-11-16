# GestorServiços - Pacote Completo para Gerar APK

## Pastas e arquivos incluídos
- `src/`: Código-fonte do aplicativo (Orçamentos, 4 fotos por item, Pix, Agenda, Clientes, Catálogo, Assistente Virtual)
- `public/`: Ícones do aplicativo Android e PWA
- `capacitor.config.json`: Configuração do Capacitor Android (`com.gestorservicos.app`)
- `.github/workflows/build-apk.yml`: Automação do GitHub Actions para compilar o `app-debug.apk`
- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `server.ts`

## Como gerar o APK pelo GitHub (sem PC)
1. Extraia este arquivo ZIP e envie todas as pastas (inclusive `.github`) para um repositório no GitHub.
2. Abra a aba **Actions** no repositório, clique em **Gerar APK Android** e execute o workflow.
3. Ao concluir, baixe o artefato **GestorServicos-APK** e instale o `app-debug.apk` no Android.

## Como gerar o APK localmente (PC com Node 22 + Java 21 + Android Studio)
```bash
npm install --legacy-peer-deps
npm run build
npm install --no-save @capacitor/core@^7.4.0 @capacitor/cli@^7.4.0 @capacitor/android@^7.4.0
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
