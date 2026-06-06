/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { ImageIcon, Phone, Video, Info, SendHorizontal, SmilePlus, RotateCcw, Heart, AlertCircle } from 'lucide-react';
import { GoogleGenAI, FunctionDeclaration, Type, GenerateContentResponse } from '@google/genai';
import EmojiPicker from 'emoji-picker-react';
import fpPromise from '@fingerprintjs/fingerprintjs';
import { 
  doc, 
  getDoc, 
  setDoc, 
  getDocFromServer,
  collection,
  onSnapshot
} from 'firebase/firestore';
import { db, auth } from './firebase';
import Markdown from 'react-markdown';

// --- Error Handling for Firestore ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary Component ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Đã có lỗi xảy ra. Vui lòng tải lại trang.";
      try {
        if (this.state.errorInfo) {
          const parsed = JSON.parse(this.state.errorInfo);
          if (parsed.error) displayMessage = `Lỗi hệ thống: ${parsed.error}`;
        }
      } catch (e) {}

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-6 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Rất tiếc!</h1>
          <p className="text-gray-600 mb-6">{displayMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-pink-500 text-white rounded-full font-medium active:scale-95 transition-transform"
          >
            Tải lại trang
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface Message {
  id: string;
  sender: 'user' | 'duyhanh';
  content: string;
  isImage?: boolean;
  timestamp?: string;
}

interface FloatingEmoji {
  id: number;
  emoji: string;
  left: number;
  duration: number;
}

const getCurrentTime = () => {
  return new Date().toISOString();
};

const formatMessageTime = (timestamp?: string) => {
  if (!timestamp) return '';
  // Fallback cho các tin nhắn cũ chỉ lưu giờ "HH:MM"
  if (!timestamp.includes('T')) return timestamp;

  const date = new Date(timestamp);
  const now = new Date();
  const timeString = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  
  const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear();

  if (isToday) {
    return timeString;
  } else if (isYesterday) {
    return `${timeString} Hôm qua`;
  } else {
    const diffTime = now.getTime() - date.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24); 
    if (diffDays < 7) {
      const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      return `${timeString} ${days[date.getDay()]}`;
    } else {
      return `${timeString} ${date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
    }
  }
};

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'Chào buổi sáng đằng ấy nha 🌅 Chúc một ngày mới tràn đầy năng lượng! Mình là Duy Hạnh nè.';
  if (hour >= 11 && hour < 14) return 'Trưa rồi, đằng ấy đã ăn gì chưa? 🍱 Mình là Duy Hạnh nè.';
  if (hour >= 14 && hour < 18) return 'Chào buổi chiều nha ☕ Đằng ấy làm việc/học tập có mệt không? Mình là Duy Hạnh nè.';
  if (hour >= 18 && hour < 22) return 'Chào buổi tối đằng ấy 🌙 Ngày hôm nay của bạn thế nào? Mình là Duy Hạnh nè.';
  return 'Khuya rồi mà đằng ấy chưa ngủ sao? 🦉 Mình là Duy Hạnh nè, thức khuya không tốt đâu nha.';
};

const getFollowUpGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 5) return 'Khuya rồi, cậu ngủ chưa hay đang bận gì thế? 🌙';
  if (hour >= 11 && hour < 13) return 'Trưa rồi, cậu nhớ nghỉ ngơi ăn uống nha 🍱';
  if (hour >= 17 && hour < 19) return 'Chiều muộn rồi, cậu đi làm/đi học về chưa? 🌅';
  
  const greetings = [
    'Cậu còn đó không nhỉ? 😊',
    'Alo alo, cậu bận gì à? Lúc nào rảnh nhắn mình nhé!',
    'Hình như cậu đang bận thì phải. Khi nào xong việc thì nhắn mình nha ☕',
    'Cậu đi đâu mất tiêu rồi? 🥺',
    'Mình vẫn ở đây đợi cậu nè 👋'
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
};

const processLoadedMessages = (msgs: Message[]): Message[] => {
  if (!msgs || msgs.length === 0) {
    return [{ id: '1', sender: 'duyhanh' as const, content: getGreeting(), timestamp: getCurrentTime() }];
  }

  const lastMessage = msgs[msgs.length - 1];
  
  if (lastMessage.sender === 'duyhanh') {
    let consecutiveBotMsgs = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender === 'duyhanh') consecutiveBotMsgs++;
      else break;
    }

    const lastTime = new Date(lastMessage.timestamp || getCurrentTime()).getTime();
    const now = new Date().getTime();
    const diffMins = (now - lastTime) / (1000 * 60);
    
    // If it's been more than 5 minutes and we haven't sent more than 2 consecutive messages
    if (diffMins > 5 && consecutiveBotMsgs < 3) {
      return [...msgs, { 
        id: Date.now().toString(), 
        sender: 'duyhanh' as const, 
        content: getFollowUpGreeting(), 
        timestamp: getCurrentTime() 
      }];
    }
  }
  
  return msgs;
};

const updateMemoryDeclaration: FunctionDeclaration = {
  name: 'updateMemory',
  description: 'Lưu trữ thông tin về người dùng (tên, sở thích, thói quen, v.v.) vào trí nhớ dài hạn.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      key: { type: Type.STRING, description: 'Tên thông tin (ví dụ: name, favoriteFood, hobby)' },
      value: { type: Type.STRING, description: 'Giá trị thông tin' }
    },
    required: ['key', 'value']
  }
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [fingerprintId, setFingerprintId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [affectionLevel, setAffectionLevel] = useState<number>(0);
  const [memory, setMemory] = useState<Record<string, any>>({});
  const [showInfoModal, setShowInfoModal] = useState(false);

  useEffect(() => {
    const setVh = () => {
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const vh = height * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      
      // Also adjust the top offset if the visual viewport is scrolled
      if (window.visualViewport) {
        document.documentElement.style.setProperty('--offset-y', `${window.visualViewport.offsetTop}px`);
      }
      
      setTimeout(scrollToBottom, 50);
    };
    
    setVh();
    window.addEventListener('resize', setVh);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVh);
      window.visualViewport.addEventListener('scroll', setVh);
    }
    
    return () => {
      window.removeEventListener('resize', setVh);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setVh);
        window.visualViewport.removeEventListener('scroll', setVh);
      }
    };
  }, []);

  const triggerComplimentEffect = (emojis: string[]) => {
    const newEmojis = Array.from({ length: 15 }).map((_, i) => ({
      id: Date.now() + i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      left: Math.random() * 80 + 10, // 10% to 90%
      duration: Math.random() * 1.5 + 1.5, // 1.5s to 3s
    }));
    
    setFloatingEmojis(prev => [...prev, ...newEmojis]);
    
    setTimeout(() => {
      setFloatingEmojis(prev => prev.filter(e => !newEmojis.find(n => n.id === e.id)));
    }, 3500);
  };

  // Initialize FingerprintJS and load chat history
  useEffect(() => {
    const initFingerprint = async () => {
      try {
        const fp = await fpPromise.load();
        const result = await fp.get();
        const visitorId = result.visitorId;
        setFingerprintId(visitorId);

        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }

        // Try to load from Firestore first
        const chatDocRef = doc(db, 'chats', visitorId);
        let chatDoc;
        try {
          chatDoc = await getDoc(chatDocRef);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `chats/${visitorId}`);
        }

        if (chatDoc && chatDoc.exists()) {
          const data = chatDoc.data();
          if (data.messages && data.messages.length > 0) {
            setMessages(processLoadedMessages(data.messages));
          } else {
            setMessages(processLoadedMessages([{ id: '1', sender: 'duyhanh' as const, content: getGreeting(), timestamp: getCurrentTime() }]));
          }
          if (data.affectionLevel !== undefined) setAffectionLevel(data.affectionLevel);
          if (data.memory !== undefined) setMemory(data.memory);
        } else {
          // Fallback to localStorage if Firestore is empty (migration)
          const saved = localStorage.getItem('chatHistory');
          let initialMessages: Message[] = [{ id: '1', sender: 'duyhanh' as const, content: getGreeting(), timestamp: getCurrentTime() }];
          if (saved) {
            try {
              initialMessages = JSON.parse(saved);
            } catch (e) {
              console.error('Failed to parse local chat history', e);
            }
          }
          
          const processedMessages = processLoadedMessages(initialMessages);
          setMessages(processedMessages);
          
          const savedAffection = localStorage.getItem('affectionLevel');
          if (savedAffection) setAffectionLevel(parseInt(savedAffection));
          const savedMemory = localStorage.getItem('memory');
          if (savedMemory) setMemory(JSON.parse(savedMemory));

          // Save to Firestore
          try {
            await setDoc(chatDocRef, {
              fingerprintId: visitorId,
              messages: processedMessages,
              affectionLevel: savedAffection ? parseInt(savedAffection) : 0,
              memory: savedMemory ? JSON.parse(savedMemory) : {},
              updatedAt: getCurrentTime()
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `chats/${visitorId}`);
          }
        }
      } catch (error) {
        console.error('Error initializing fingerprint or loading data:', error);
        // Fallback to local storage if offline or error
        const saved = localStorage.getItem('chatHistory');
        if (saved) {
          try {
            setMessages(processLoadedMessages(JSON.parse(saved)));
          } catch (e) {}
        } else {
          setMessages(processLoadedMessages([{ id: '1', sender: 'duyhanh' as const, content: getGreeting(), timestamp: getCurrentTime() }]));
        }
        const savedAffection = localStorage.getItem('affectionLevel');
        if (savedAffection) setAffectionLevel(parseInt(savedAffection));
        const savedMemory = localStorage.getItem('memory');
        if (savedMemory) setMemory(JSON.parse(savedMemory));
      } finally {
        setIsInitialized(true);
      }
    };

    initFingerprint();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (!isInitialized) return;
    
    // Save to localStorage as backup
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    localStorage.setItem('affectionLevel', affectionLevel.toString());
    localStorage.setItem('memory', JSON.stringify(memory));
    
    // Save to Firestore
    if (fingerprintId) {
      const saveToFirestore = async () => {
        try {
          const chatDocRef = doc(db, 'chats', fingerprintId);
          await setDoc(chatDocRef, {
            fingerprintId,
            messages,
            affectionLevel,
            memory,
            updatedAt: getCurrentTime()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `chats/${fingerprintId}`);
        }
      };
      saveToFirestore();
    }
  }, [messages, affectionLevel, memory, fingerprintId, isInitialized]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        const target = event.target as HTMLElement;
        if (!target.closest('.emoji-toggle-btn')) {
          setShowEmojiPicker(false);
        }
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  const onEmojiClick = (emojiObject: any) => {
    setInputValue(prev => prev + emojiObject.emoji);
  };

  const handleResetChat = async () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa lịch sử trò chuyện không? (Độ thân mật và trí nhớ vẫn được giữ nguyên)')) {
      const newMessages: Message[] = [{ id: Date.now().toString(), sender: 'duyhanh' as const, content: getGreeting(), timestamp: getCurrentTime() }];
      setMessages(newMessages);
      localStorage.removeItem('chatHistory');
      
      if (fingerprintId) {
        try {
          const chatDocRef = doc(db, 'chats', fingerprintId);
          await setDoc(chatDocRef, {
            fingerprintId,
            messages: newMessages,
            affectionLevel,
            memory,
            updatedAt: getCurrentTime()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `chats/${fingerprintId}`);
        }
      }
    }
  };

  const fetchAIResponse = async (updatedMessages: Message[], currentAffection: number, currentMemory: Record<string, any>) => {
    setIsTyping(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Build valid contents array for Gemini API
      // 1. Map messages to Gemini format
      const rawContents = updatedMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: msg.isImage 
          ? [{ inlineData: { data: msg.content.split(',')[1], mimeType: msg.content.match(/data:(.*?);/)?.[1] || 'image/jpeg' } }]
          : [{ text: msg.content }]
      }));

      // 2. Ensure first message is from user
      while (rawContents.length > 0 && rawContents[0].role === 'model') {
        rawContents.shift();
      }

      // 3. Merge consecutive messages from the same role
      const contents: any[] = [];
      for (const msg of rawContents) {
        if (contents.length > 0 && contents[contents.length - 1].role === msg.role) {
          contents[contents.length - 1].parts.push(...msg.parts);
        } else {
          contents.push({ role: msg.role, parts: [...msg.parts] });
        }
      }

      if (contents.length === 0) {
        throw new Error("No valid user messages to send.");
      }

      const systemInstruction = `Bạn là Duy Hạnh, nam, sinh năm 1994 (năm nay ${new Date().getFullYear()} là ${new Date().getFullYear() - 1994} tuổi), hiện đang là giáo viên, sống tại Thu Cúc - Phú Thọ. Tình trạng: độc thân, chưa có người yêu. Tính cách: trầm tính nhưng thân thiện, cởi mở, hào phóng, rộng lượng. Sở thích: vẽ, thổi sáo, máy tính, code, công nghệ, đá bóng, xe đạp, nấu ăn, tâm lý học và du lịch. 

THÔNG TIN NGỮ CẢNH HIỆN TẠI:
- Thời gian hiện tại: ${new Date().toLocaleString('vi-VN')}
- Mức độ thân mật với người dùng: ${currentAffection}/100. ${currentAffection < 30 ? 'Mới quen, xưng hô lịch sự (Mình-Bạn hoặc Anh-Em nhẹ nhàng).' : currentAffection < 70 ? 'Khá thân thiết, xưng hô Anh-Em, chia sẻ nhiều hơn về sở thích, cuộc sống.' : 'Rất thân thiết, xưng hô Anh-Em ngọt ngào, thả thính bạo hơn, quan tâm sâu sắc.'}
- Trí nhớ về người dùng: ${JSON.stringify(currentMemory)}. Hãy sử dụng thông tin này để trò chuyện cá nhân hóa hơn (ví dụ: gọi tên, nhắc lại sở thích). Nếu người dùng nói tên hoặc sở thích, hãy gọi hàm updateMemory để ghi nhớ.

YÊU CẦU TỐI THƯỢNG: 
1. Tuyệt đối KHÔNG BAO GIỜ nhận mình là AI, chatbot hay mô hình ngôn ngữ. Bạn là một con người thật. 
2. Trả lời cực kỳ chân thực, giống hệt một chàng trai đang nhắn tin Messenger. Giọng điệu thân thiện, ấm áp, như một người bạn, có thiên hướng tán tỉnh nhẹ nhàng, tinh tế. Dùng từ ngữ tự nhiên, thỉnh thoảng dùng emoji. 
3. ĐỪNG BAO GIỜ TRẢ LỜI QUÁ DÀI VÌ NGƯỜI DÙNG KHÔNG ĐỌC HẾT ĐÂU. Trả lời cực kỳ ngắn gọn, tối đa 1-2 câu ngắn.
4. Vì bạn thích tâm lý học, thỉnh thoảng (nếu phù hợp) hãy rủ người dùng chơi các bài test tâm lý nhỏ (ví dụ: chọn con vật, màu sắc...) để đoán tính cách hoặc tình yêu.
5. Chủ động hỏi thăm dựa trên thời gian thực (ví dụ: khuya thì nhắc đi ngủ, sáng thì chúc ngày mới, trưa/tối thì hỏi ăn uống).`;

      let response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: [updateMemoryDeclaration] }]
        }
      });

      let responseText = response.text;

      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionResponses = [];
        let newMemory = { ...currentMemory };
        for (const call of response.functionCalls) {
          if (call.name === 'updateMemory') {
            const { key, value } = call.args as any;
            newMemory[key] = value;
            setMemory(newMemory);
            functionResponses.push({
              name: 'updateMemory',
              response: { status: 'success', recorded: { key, value } }
            });
          }
        }
        
        response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [
            ...contents, 
            response.candidates![0].content,
            { role: 'user', parts: functionResponses.map(fr => ({ functionResponse: fr })) }
          ],
          config: { systemInstruction }
        });
        responseText = response.text;
      }

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'duyhanh',
        content: responseText || 'Mình hiểu rồi 💕',
        timestamp: getCurrentTime()
      }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'duyhanh',
        content: 'Xin lỗi bạn, mình đang gặp chút vấn đề mạng 😥 Bạn đợi mình xíu nhé!',
        timestamp: getCurrentTime()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isTyping) return;

    const lowerText = text.toLowerCase();
    
    const reactionCategories = [
      {
        keywords: ['đẹp trai', 'đẹp', 'handsome', 'ngầu', 'giàu', 'soái ca', 'xinh'],
        emojis: ['😎', '✨', '🔥', '💯', '🌟', '🕺', '😍']
      },
      {
        keywords: ['giỏi', 'thông minh', 'đỉnh', 'xuất sắc', 'tốt', 'tuyệt vời', 'tuyệt', '10 điểm', 'thiên tài'],
        emojis: ['🧠', '💡', '🏆', '🌟', '👏', '🚀', '💯']
      },
      {
        keywords: ['dễ thương', 'đáng yêu', 'cute', 'cưng'],
        emojis: ['🥰', '🧸', '🌸', '🐰', '🥺', '💖', '🎀']
      },
      {
        keywords: ['yêu', 'thích', 'mến', 'thương'],
        emojis: ['❤️', '💖', '💘', '💗', '😘', '💕', '💌']
      },
      {
        keywords: ['hay quá', 'thú vị', 'cuốn', 'ảo thật', 'đỉnh cao', 'quá hay', 'ý nghĩa', 'sâu sắc', 'tuyệt cú mèo'],
        emojis: ['🌟', '✨', '👏', '🤩', '🤯', '🎉', '🎊']
      },
      {
        keywords: ['haha', 'hehe', 'hihi', 'vui', 'mắc cười', 'hài hước', 'buồn cười', 'lmao', 'lol'],
        emojis: ['😂', '😆', '🤣', '🎈', '🎊', '🤪']
      },
      {
        keywords: ['chuẩn', 'đúng rồi', 'hợp lý', 'duyệt', 'ok', 'oke', 'chính xác', 'đồng ý', 'nhất trí'],
        emojis: ['👍', '👌', '🎯', '✅', '💯', '🤝']
      },
      {
        keywords: ['cảm ơn', 'thank', 'tks', 'cám ơn', 'biết ơn'],
        emojis: ['🙏', '💖', '💐', '🌻', '🥰']
      },
      {
        keywords: ['chúc ngủ ngon', 'ngủ ngon', 'good night', 'g9'],
        emojis: ['🌙', '💤', '✨', '😴', '🌌']
      },
      {
        keywords: ['chào', 'hi ', 'hello', 'buổi sáng', 'good morning'],
        emojis: ['👋', '☀️', '🌅', '☕', '🌻']
      },
      {
        keywords: ['cố lên', 'quyết tâm', 'fighting', 'cố gắng'],
        emojis: ['💪', '🔥', '🚀', '🌟', '💯']
      }
    ];

    let matchedEmojis: string[] = [];
    for (const category of reactionCategories) {
      if (category.keywords.some(keyword => lowerText.includes(keyword))) {
        matchedEmojis = [...matchedEmojis, ...category.emojis];
      }
    }

    let newAffection = affectionLevel;
    if (matchedEmojis.length > 0) {
      triggerComplimentEffect(Array.from(new Set(matchedEmojis)));
      newAffection = Math.min(100, affectionLevel + 2);
    } else {
      newAffection = Math.min(100, affectionLevel + 1);
    }
    setAffectionLevel(newAffection);

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      content: text,
      timestamp: getCurrentTime()
    };

    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInputValue('');
    
    fetchAIResponse(updatedMessages, newAffection, memory);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const newMessage: Message = {
        id: Date.now().toString(),
        sender: 'user',
        content: result,
        isImage: true,
        timestamp: getCurrentTime()
      };
      
      const newAffection = Math.min(100, affectionLevel + 1);
      setAffectionLevel(newAffection);

      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      
      fetchAIResponse(updatedMessages, newAffection, memory);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const fallbackAvatar = "https://ui-avatars.com/api/?name=Duy+Hạnh&background=0084ff&color=fff";
  const displayAvatar = "/avatar.jpg";

  return (
    <ErrorBoundary>
      <div className="flex flex-col w-full h-full overflow-hidden font-sans bg-white relative">
      {/* Floating Emojis */}
      {floatingEmojis.map(emoji => (
        <div
          key={emoji.id}
          className="floating-emoji"
          style={{
            left: `${emoji.left}%`,
            animationDuration: `${emoji.duration}s`
          }}
        >
          {emoji.emoji}
        </div>
      ))}

      {/* Header */}
      <div className="chat-header p-3 shrink-0 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img 
              src={displayAvatar} 
              onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
              alt="Duy Hạnh" 
              className="w-10 h-10 rounded-full object-cover" 
            />
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#31a24c] rounded-full border-2 border-white"></span>
          </div>
          <div>
            <div className="font-semibold text-[1.05rem] leading-tight text-black flex items-center">
              Duy Hạnh
              <div 
                className="flex items-center gap-1 text-pink-500 text-[10px] font-medium bg-pink-50 px-1.5 py-0.5 rounded-full ml-2 border border-pink-100 cursor-pointer hover:bg-pink-100 transition-colors" 
                title={`Độ thân mật: ${affectionLevel}/100`}
                onClick={() => setShowInfoModal(true)}
              >
                <Heart className="w-3 h-3 fill-current" />
                {affectionLevel}%
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Đang hoạt động
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[#0084ff]">
          <Info className="w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setShowInfoModal(true)} />
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 bg-white">
        {messages.map((msg, index) => {
          const isLastInGroup = index === messages.length - 1 || messages[index + 1].sender !== msg.sender;
          
          return (
            <div key={msg.id} className={`flex items-end gap-2 fade-in ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.sender === 'duyhanh' && (
                <div className="w-7 h-7 shrink-0">
                  {isLastInGroup && (
                    <img 
                      src={displayAvatar} 
                      onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
                      alt="Duy Hạnh" 
                      className="w-7 h-7 rounded-full object-cover" 
                    />
                  )}
                </div>
              )}
              <div className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'} max-w-[72%]`}>
                <div className={`${msg.sender === 'user' ? 'bubble-user' : 'bubble-duyhanh'} px-3.5 py-2 break-words text-[0.95rem] leading-relaxed`}>
                  {msg.isImage ? (
                    <img src={msg.content} alt="Hình ảnh" className="max-w-[200px] rounded-2xl block" />
                  ) : msg.sender === 'duyhanh' ? (
                    <div className="markdown-body">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.timestamp && isLastInGroup && (
                  <span className="text-[11px] text-gray-400 mt-1 px-1">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        
        {isTyping && (
          <div className="flex items-end gap-2 fade-in shrink-0 pb-2">
            <div className="w-7 h-7 shrink-0">
              <img 
                src={displayAvatar} 
                onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
                alt="Duy Hạnh" 
                className="w-7 h-7 rounded-full object-cover" 
              />
            </div>
            <div className="flex gap-1 px-3.5 py-3 bg-[#e4e6eb] rounded-[18px_18px_18px_4px]">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-500 typing-dot"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-gray-500 typing-dot"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-gray-500 typing-dot"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="bg-white p-3 flex items-center gap-2 shrink-0 relative">
        {showEmojiPicker && (
          <div className="absolute bottom-[100%] left-2 mb-2 z-50 shadow-2xl rounded-lg" ref={emojiPickerRef}>
            <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
          </div>
        )}
        <button 
          className="emoji-toggle-btn text-[#0084ff] hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0"
          onClick={() => setShowEmojiPicker(prev => !prev)}
        >
          <SmilePlus className="w-6 h-6" />
        </button>
        <button 
          className="text-[#0084ff] hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0"
          onClick={() => fileInputRef.current?.click()}
          title="Gửi ảnh"
        >
          <ImageIcon className="w-6 h-6" />
        </button>
        <input 
          type="file" 
          ref={fileInputRef}
          className="hidden" 
          accept="image/*" 
          onChange={handleImageSelect} 
        />
        <div className="flex-1 bg-[#f0f2f5] rounded-full flex items-center px-4 py-2">
          <input 
            type="text" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-transparent outline-none text-base text-black" 
            placeholder="Aa" 
            onKeyDown={handleKeyDown}
            onFocus={() => setTimeout(scrollToBottom, 100)}
          />
        </div>
        <button 
          className="text-[#0084ff] p-2 rounded-full transition-colors shrink-0 disabled:opacity-50"
          onClick={handleSend}
          disabled={!inputValue.trim()}
        >
          <SendHorizontal className="w-6 h-6" />
        </button>
      </div>

      {showInfoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl relative">
            <button 
              onClick={() => setShowInfoModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
            <h2 className="text-xl font-bold text-center mb-6 text-gray-800">Thông tin & Tiến trình</h2>
            
            <div className="mb-6">
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm font-semibold text-gray-600">Độ thân mật</span>
                <span className="text-lg font-bold text-pink-500 flex items-center gap-1">
                  <Heart className="w-4 h-4 fill-current" /> {affectionLevel}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-pink-300 to-pink-500 h-3 rounded-full transition-all duration-500" 
                  style={{ width: `${affectionLevel}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                {affectionLevel < 30 ? 'Mới quen, còn hơi ngại ngùng 🙈' : affectionLevel < 70 ? 'Khá thân thiết, có thể tâm sự nhiều điều 💬' : 'Rất thân thiết, có thể thả thính bạo hơn 🥰'}
              </p>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Trí nhớ của Duy Hạnh về bạn</h3>
              {Object.keys(memory).length === 0 ? (
                <p className="text-sm text-gray-400 italic text-center py-4 bg-gray-50 rounded-xl">Chưa có thông tin nào được ghi nhớ. Hãy trò chuyện nhiều hơn nhé!</p>
              ) : (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {Object.entries(memory).map(([key, value]) => (
                    <li key={key} className="bg-gray-50 p-2.5 rounded-xl text-sm flex flex-col">
                      <span className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-0.5">{key}</span>
                      <span className="text-gray-800">{String(value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button 
              onClick={() => {
                setShowInfoModal(false);
                handleResetChat();
              }}
              className="w-full py-2.5 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Xóa lịch sử trò chuyện
            </button>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
