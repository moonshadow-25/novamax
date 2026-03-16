import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Home from './pages/Home/Home';
import LLMChat from './pages/LLMChat/LLMChat';
import ComfyUI from './pages/ComfyUI/ComfyUI';
import TTS from './pages/TTS/TTS';
import Whisper from './pages/Whisper/Whisper';
import Settings from './pages/Settings/Settings';
import GlobalSettings from './pages/GlobalSettings/GlobalSettings';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/llm/:modelId" element={<LLMChat />} />
          <Route path="/comfyui/:modelId" element={<ComfyUI />} />
          <Route path="/tts/:modelId" element={<TTS />} />
          <Route path="/whisper/:modelId" element={<Whisper />} />
          <Route path="/settings/:modelId" element={<Settings />} />
          <Route path="/global-settings" element={<GlobalSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
