import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rykoccllection.animediscovery',
  appName: 'RykoCollection',
  webDir: 'dist',
  bundledWebRuntime: false,
  backgroundColor: '#000000',
  android: {
    allowMixedContent: false,
    backgroundColor: '#000000'
  }
};

export default config;
