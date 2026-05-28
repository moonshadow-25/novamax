import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCommon from './locales/zh-CN/common.json';
import zhHome from './locales/zh-CN/home.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhGlobalSettings from './locales/zh-CN/globalSettings.json';
import enCommon from './locales/en-US/common.json';
import enHome from './locales/en-US/home.json';
import enSettings from './locales/en-US/settings.json';
import enGlobalSettings from './locales/en-US/globalSettings.json';

const STORAGE_KEY = 'novamax_locale';

const resources = {
  'zh-CN': {
    common: zhCommon,
    home: zhHome,
    settings: zhSettings,
    globalSettings: zhGlobalSettings,
  },
  'en-US': {
    common: enCommon,
    home: enHome,
    settings: enSettings,
    globalSettings: enGlobalSettings,
  },
};

const saved = localStorage.getItem(STORAGE_KEY);
const browserLocale = navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
const lng = saved || browserLocale;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng,
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
  });

export const setLocale = (locale) => {
  localStorage.setItem(STORAGE_KEY, locale);
  i18n.changeLanguage(locale);
};

export default i18n;
