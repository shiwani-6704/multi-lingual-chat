const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// OpenRouter API endpoint
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store active users (userId -> socket)
const activeUsers = new Map();

// Available languages
const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' }
];

// Language name mapping for better translation
const languageNames = {
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'nl': 'Dutch',
  'pl': 'Polish',
  'tr': 'Turkish'
};

// Function to translate text using OpenRouter API
async function translateText(text, targetLanguage, sourceLanguage = 'auto') {
  try {
    // Check for OpenRouter API key (preferred) or OpenAI API key (fallback)
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
    
    if (apiKey) {
      const targetLangName = languageNames[targetLanguage] || targetLanguage;
      const sourceLangName = sourceLanguage === 'auto' ? 'the source language' : (languageNames[sourceLanguage] || sourceLanguage);
      
      try {
        const apiUrl = useOpenRouter 
          ? OPENROUTER_API_URL 
          : 'https://api.openai.com/v1/chat/completions';
        
        const model = useOpenRouter 
          ? 'openai/gpt-3.5-turbo' // Using OpenAI model via OpenRouter
          : 'gpt-3.5-turbo';
        
        const response = await axios.post(
          apiUrl,
          {
            model: model,
            messages: [
              {
                role: 'system',
                content: `You are a professional translator. Your task is to translate the entire text accurately from ${sourceLangName} to ${targetLangName}. Translate the complete message maintaining the meaning, tone, and context. Return ONLY the translated text in ${targetLangName}, nothing else - no explanations, no additional text, just the translation.`
              },
              {
                role: 'user',
                content: `Translate this text to ${targetLangName}: "${text}"`
              }
            ],
            temperature: 0.3,
            max_tokens: 500
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              ...(useOpenRouter && {
                'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'http://localhost:3000',
                'X-Title': 'Multilingual Chat App'
              })
            }
          }
        );
        
        const translated = response.data.choices[0].message.content.trim();
        // Remove any quotes if the translation is wrapped in quotes
        const cleanTranslation = translated.replace(/^["']|["']$/g, '');
        return cleanTranslation;
      } catch (apiError) {
        // Check if it's a quota/billing error
        if (apiError.response?.data?.error?.code === 'insufficient_quota' || 
            apiError.response?.data?.error?.message?.includes('quota') ||
            apiError.response?.data?.error?.message?.includes('billing')) {
          console.warn('API quota exceeded. Using fallback translation.');
          // Fall through to fallback translation
        } else {
          // Re-throw other API errors
          throw apiError;
        }
      }
    }
    
    // Fallback: Return original text with note (for testing when API quota is exceeded)
    console.log(`Using fallback: Original text returned (API quota exceeded or no API key)`);
    return text; // Return original text instead of mock translation
  } catch (error) {
    console.error('Translation error:', error);
    if (error.response) {
      // API error
      const errorMsg = error.response.data?.error?.message || error.message;
      const errorCode = error.response.data?.error?.code;
      
      // If quota exceeded, return original text
      if (errorCode === 'insufficient_quota' || errorMsg.includes('quota') || errorMsg.includes('billing')) {
        console.warn('API quota exceeded. Returning original text.');
        return text;
      }
      
      console.error('API error:', errorMsg);
      throw new Error(`Translation failed: ${errorMsg}`);
    } else if (error.request) {
      // Network error
      throw new Error('Translation failed: Cannot connect to translation API. Check your internet connection.');
    } else {
      // Other error
      throw new Error(`Translation failed: ${error.message}`);
    }
  }
}

// API endpoint for translation
app.post('/api/translate', async (req, res) => {
  try {
    const { text, targetLanguage, sourceLanguage } = req.body;
    
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'Text and targetLanguage are required' });
    }

    // Check if API key is configured
    if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
      console.error('No API key found. OPENROUTER_API_KEY or OPENAI_API_KEY must be set in environment variables');
      return res.status(500).json({ 
        error: 'Translation service not configured. Please set OPENROUTER_API_KEY or OPENAI_API_KEY in server/.env file.' 
      });
    }

    const translatedText = await translateText(text, targetLanguage, sourceLanguage);
    res.json({ translatedText });
  } catch (error) {
    console.error('Translation API error:', error);
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    res.status(500).json({ 
      error: error.message || 'Translation failed. Please check your API key and try again.' 
    });
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send available languages to client
  socket.emit('languages', languages);

  // Handle user authentication
  socket.on('authenticate', (data) => {
    const { userId, email } = data;
    activeUsers.set(userId, socket);
    socket.userId = userId;
    console.log(`User authenticated: ${userId} (${email})`);
  });

  // Handle private messages
  socket.on('private-message', async (data) => {
    const { senderId, receiverId, text, originalText, targetLanguage, originalLanguage } = data;
    
    if (!senderId || !receiverId) {
      socket.emit('error', { message: 'Sender and receiver IDs are required' });
      return;
    }

    // Find receiver's socket
    const receiverSocket = activeUsers.get(receiverId);
    
    if (receiverSocket) {
      // Send message to receiver
      receiverSocket.emit('private-message', {
        id: Date.now().toString(),
        senderId,
        receiverId,
        text,
        originalText,
        targetLanguage,
        originalLanguage,
        timestamp: new Date().toISOString()
      });
    }

    // Confirm to sender
    socket.emit('message-sent', {
      id: Date.now().toString(),
      senderId,
      receiverId,
      text,
      originalText,
      targetLanguage,
      originalLanguage,
      timestamp: new Date().toISOString()
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (socket.userId) {
      activeUsers.delete(socket.userId);
      console.log(`User disconnected: ${socket.userId}`);
    }
  });
});

// API endpoint to get languages
app.get('/api/languages', (req, res) => {
  res.json(languages);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.OPENROUTER_API_KEY) {
    console.log('Using OpenRouter API for translation');
  } else if (process.env.OPENAI_API_KEY) {
    console.log('Using OpenAI API for translation');
  } else {
    console.log('⚠️  No API key found. Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env file for translation to work');
  }
});
