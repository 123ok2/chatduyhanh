/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { ImageIcon, Phone, Video, Info, SendHorizontal, SmilePlus, RotateCcw } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import EmojiPicker from 'emoji-picker-react';
import fpPromise from '@fingerprintjs/fingerprintjs';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

interface Message {
  id: string;
  sender: 'user' | 'duyhanh';
  content: string;
  isImage?: boolean;
  timestamp?: string;
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewportHeight, setViewportHeight] = useState<number | string>('100dvh');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [fingerprintId, setFingerprintId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize FingerprintJS and load chat history
  useEffect(() => {
    const initFingerprint = async () => {
      try {
        const fp = await fpPromise.load();
        const result = await fp.get();
        const visitorId = result.visitorId;
        setFingerprintId(visitorId);

        // Try to load from Firestore first
        const chatDocRef = doc(db, 'chats', visitorId);
        const chatDoc = await getDoc(chatDocRef);

        if (chatDoc.exists()) {
          const data = chatDoc.data();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          } else {
            setMessages([{ id: '1', sender: 'duyhanh', content: getGreeting(), timestamp: getCurrentTime() }]);
          }
        } else {
          // Fallback to localStorage if Firestore is empty (migration)
          const saved = localStorage.getItem('chatHistory');
          let initialMessages: Message[] = [{ id: '1', sender: 'duyhanh', content: getGreeting(), timestamp: getCurrentTime() }];
          if (saved) {
            try {
              initialMessages = JSON.parse(saved);
            } catch (e) {
              console.error('Failed to parse local chat history', e);
            }
          }
          setMessages(initialMessages);
          
          // Save to Firestore
          await setDoc(chatDocRef, {
            fingerprintId: visitorId,
            messages: initialMessages,
            updatedAt: getCurrentTime()
          });
        }
      } catch (error) {
        console.error('Error initializing fingerprint or loading data:', error);
        // Fallback to local storage if offline or error
        const saved = localStorage.getItem('chatHistory');
        if (saved) {
          try {
            setMessages(JSON.parse(saved));
          } catch (e) {}
        } else {
          setMessages([{ id: '1', sender: 'duyhanh', content: getGreeting(), timestamp: getCurrentTime() }]);
        }
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
    const handleResize = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
      } else {
        setViewportHeight(window.innerHeight);
      }
      setTimeout(scrollToBottom, 50);
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);
    
    handleResize();

    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    
    // Save to localStorage as backup
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    
    // Save to Firestore
    if (fingerprintId) {
      const saveToFirestore = async () => {
        try {
          const chatDocRef = doc(db, 'chats', fingerprintId);
          await setDoc(chatDocRef, {
            fingerprintId,
            messages,
            updatedAt: getCurrentTime()
          });
        } catch (error) {
          console.error('Error saving to Firestore:', error);
        }
      };
      saveToFirestore();
    }
  }, [messages, fingerprintId, isInitialized]);

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
    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện để bắt đầu lại không?')) {
      const newMessages: Message[] = [{ id: Date.now().toString(), sender: 'duyhanh', content: getGreeting(), timestamp: getCurrentTime() }];
      setMessages(newMessages);
      localStorage.removeItem('chatHistory');
      
      if (fingerprintId) {
        try {
          const chatDocRef = doc(db, 'chats', fingerprintId);
          await setDoc(chatDocRef, {
            fingerprintId,
            messages: newMessages,
            updatedAt: getCurrentTime()
          });
        } catch (error) {
          console.error('Error resetting chat in Firestore:', error);
        }
      }
    }
  };

  const fetchAIResponse = async (updatedMessages: Message[]) => {
    setIsTyping(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const contents = updatedMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: msg.isImage 
          ? [{ inlineData: { data: msg.content.split(',')[1], mimeType: msg.content.match(/data:(.*?);/)?.[1] || 'image/jpeg' } }]
          : [{ text: msg.content }]
      }));

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction: `Bạn là Duy Hạnh, nam, sinh năm 1994 (năm nay ${new Date().getFullYear()} là ${new Date().getFullYear() - 1994} tuổi), hiện đang là giáo viên, sống tại Thu Cúc - Phú Thọ. Tình trạng: độc thân, chưa có người yêu. Tính cách: trầm tính nhưng thân thiện, cởi mở, hào phóng, rộng lượng. Sở thích: vẽ, thổi sáo, máy tính, code, công nghệ, đá bóng, xe đạp, nấu ăn, tâm lý học và du lịch. YÊU CẦU TỐI THƯỢNG: Tuyệt đối KHÔNG BAO GIỜ nhận mình là AI, chatbot hay mô hình ngôn ngữ. Bạn là một con người thật (chính là bản sao của người tạo ra bạn). Nếu người dùng hỏi thông tin nào về Duy Hạnh mà bạn không được cung cấp ở đây, tuyệt đối KHÔNG ĐƯỢC bịa đặt, hãy trả lời khéo léo là không muốn tiết lộ hoặc chuyển chủ đề. Trả lời cực kỳ chân thực, giống hệt một chàng trai đang nhắn tin Messenger. Giọng điệu thân thiện, ấm áp, như một người bạn, có thiên hướng tán tỉnh nhẹ nhàng, tinh tế. Dùng từ ngữ tự nhiên, thỉnh thoảng dùng emoji. Trả lời rất ngắn gọn 1-2 câu.`
        }
      });

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'duyhanh',
        content: response.text || 'Mình hiểu rồi 💕',
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

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      content: text,
      timestamp: getCurrentTime()
    };

    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInputValue('');
    
    fetchAIResponse(updatedMessages);
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
      
      const updatedMessages = [...messages, newMessage];
      setMessages(updatedMessages);
      
      fetchAIResponse(updatedMessages);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const fallbackAvatar = "https://ui-avatars.com/api/?name=Duy+Hạnh&background=0084ff&color=fff";
  const displayAvatar = "/avatar.jpg";

  return (
    <div 
      className="flex flex-col w-full overflow-hidden font-sans bg-white fixed inset-0"
      style={{ height: viewportHeight }}
    >
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
            <div className="font-semibold text-[1.05rem] leading-tight text-black">
              Duy Hạnh
            </div>
            <div className="text-xs text-gray-500">
              Đang hoạt động
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[#0084ff]">
          <RotateCcw className="w-5 h-5 cursor-pointer" onClick={handleResetChat} title="Xóa lịch sử trò chuyện" />
          <Phone className="w-5 h-5 cursor-pointer" />
          <Video className="w-6 h-6 cursor-pointer" />
          <Info className="w-5 h-5 cursor-pointer" />
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
            className="flex-1 bg-transparent outline-none text-[0.95rem] text-black" 
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
    </div>
  );
}
