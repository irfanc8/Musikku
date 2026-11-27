import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irfan.musicplayer',
  appName: 'Musikku',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;
