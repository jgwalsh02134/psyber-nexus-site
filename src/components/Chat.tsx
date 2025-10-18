const Chat: React.FC = () => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    
    // ...existing code...
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="chat-container" role="region" aria-label="Chat interface">
      <header className="chat-header">
        <h2>AI Assistant</h2>
      </header>
      
      <div className="chat-messages" role="log" aria-live="polite" aria-atomic="false">
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <h3>Welcome to Psyber Nexus</h3>
            <p>Start a conversation with our AI assistant</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`chat-message ${message.role}`}
              role="article"
              aria-label={`${message.role} message`}
            >
              <div className={`message-avatar ${message.role}`}>
                {message.role === 'user' ? 'U' : 'AI'}
              </div>
              <div className="message-content">{message.content}</div>
            </div>
          ))
        )}
        
        {isTyping && (
          <div className="typing-indicator" role="status" aria-label="AI is typing">
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
            <div className="typing-dot"></div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <div className="chat-input-container">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          rows={1}
          aria-label="Chat message input"
          disabled={isTyping}
        />
        <button
          className="chat-send-button"
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
          aria-label="Send message"
        >
          <span className="mobile-only">➤</span>
          <span className="tablet-up">Send</span>
        </button>
      </div>
    </div>
  );
};

export default Chat;