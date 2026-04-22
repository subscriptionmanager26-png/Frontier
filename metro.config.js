const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

/** Required for `expo-sqlite` on web (`import … from '…wasm'`). */
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

/** Metro resolves imports before Babel; `@/…` must be handled here (not only in tsconfig / Babel). */
const SOURCE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.json'];

function resolveAtAlias(moduleName) {
  if (typeof moduleName !== 'string' || !moduleName.startsWith('@/')) {
    return null;
  }
  const rel = moduleName.slice(2);
  const base = path.resolve(projectRoot, rel);

  if (fs.existsSync(base)) {
    const st = fs.statSync(base);
    if (st.isFile()) return base;
    if (st.isDirectory()) {
      for (const ext of SOURCE_EXTS) {
        const indexFile = path.join(base, `index${ext}`);
        if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
          return indexFile;
        }
      }
    }
  }

  for (const ext of SOURCE_EXTS) {
    const file = base + ext;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return file;
    }
  }

  return null;
}

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = resolveAtAlias(moduleName);
  if (filePath) {
    return { type: 'sourceFile', filePath };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
