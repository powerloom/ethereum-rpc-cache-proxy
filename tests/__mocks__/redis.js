// Mock Redis client for testing
const store = new Map();
const expiry = new Map();

export const createClient = jest.fn(() => {
  const mockClient = {
    connected: false,
    isOpen: true,
    isReady: true,
    
    connect: jest.fn().mockImplementation(async function() {
      this.connected = true;
      return this;
    }),
    
    disconnect: jest.fn().mockImplementation(async function() {
      this.connected = false;
      store.clear();
      expiry.clear();
      return this;
    }),
    
    quit: jest.fn().mockImplementation(async function() {
      this.connected = false;
      store.clear();
      expiry.clear();
      return this;
    }),
    
    get: jest.fn().mockImplementation(async (key) => {
      const expiryTime = expiry.get(key);
      if (expiryTime && Date.now() > expiryTime) {
        store.delete(key);
        expiry.delete(key);
        return null;
      }
      return store.get(key) || null;
    }),
    
    set: jest.fn().mockImplementation(async (key, value, options = {}) => {
      // Handle SET NX (for distributed lock)
      if (options.NX && store.has(key)) {
        return null;
      }
      
      store.set(key, value);
      
      // Handle TTL
      if (options.EX) {
        expiry.set(key, Date.now() + (options.EX * 1000));
      } else if (options.PX) {
        expiry.set(key, Date.now() + options.PX);
      }
      
      return 'OK';
    }),
    
    setex: jest.fn().mockImplementation(async (key, ttl, value) => {
      store.set(key, value);
      expiry.set(key, Date.now() + (ttl * 1000));
      return 'OK';
    }),
    
    del: jest.fn().mockImplementation(async (key) => {
      const existed = store.has(key);
      store.delete(key);
      expiry.delete(key);
      return existed ? 1 : 0;
    }),
    
    exists: jest.fn().mockImplementation(async (key) => {
      const expiryTime = expiry.get(key);
      if (expiryTime && Date.now() > expiryTime) {
        store.delete(key);
        expiry.delete(key);
        return 0;
      }
      return store.has(key) ? 1 : 0;
    }),
    
    flushAll: jest.fn().mockImplementation(async () => {
      store.clear();
      expiry.clear();
      return 'OK';
    }),
    
    on: jest.fn().mockImplementation(function(event, handler) {
      return this;
    }),
    
    // Additional methods for compatibility
    expire: jest.fn().mockResolvedValue(1),
    pExpire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    keys: jest.fn().mockResolvedValue([]),
    mGet: jest.fn().mockResolvedValue([]),
    mSet: jest.fn().mockResolvedValue('OK'),
    multi: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
    dbSize: jest.fn().mockResolvedValue(0),
    info: jest.fn().mockResolvedValue('redis_info'),
    
    // For testing
    _store: store,
    _expiry: expiry
  };
  
  return mockClient;
});

export default { createClient };