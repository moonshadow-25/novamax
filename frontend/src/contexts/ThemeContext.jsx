import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme } from 'antd';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

const themes = {
  dark: {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: '#1890ff',
      colorBgBase: '#141414',
      colorTextBase: '#ffffff'
    }
  },
  light: {
    algorithm: theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1890ff',
      colorBgBase: '#ffffff',
      colorTextBase: '#000000'
    }
  }
};

const THEME_STORAGE_KEY = 'theme-mode';

const resolveSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState('system');
  const [systemTheme, setSystemTheme] = useState(resolveSystemTheme);

  const currentTheme = themeMode === 'system' ? systemTheme : themeMode;

  useEffect(() => {
    const savedThemeMode = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    setThemeMode(savedThemeMode);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light');

    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.setAttribute('data-theme', currentTheme);
    root.setAttribute('data-theme-mode', themeMode);
    root.style.colorScheme = currentTheme;

    if (body) {
      body.setAttribute('data-theme', currentTheme);
      body.setAttribute('data-theme-mode', themeMode);
    }
  }, [currentTheme, themeMode]);

  const handleSetThemeMode = (nextThemeMode) => {
    setThemeMode(nextThemeMode);
    localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode);
  };

  const value = useMemo(() => ({
    theme: currentTheme,
    themeMode,
    effectiveTheme: currentTheme,
    setThemeMode: handleSetThemeMode,
    toggleTheme: () => handleSetThemeMode(currentTheme === 'dark' ? 'light' : 'dark')
  }), [currentTheme, themeMode]);

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={themes[currentTheme]}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
