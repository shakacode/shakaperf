import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { Product, CartItem, CartContextType } from '../types';

const CartContext = createContext<CartContextType | null>(null);

const CART_TOKEN_KEY = 'cart_session_token';

function getOrCreateCartToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  let token = localStorage.getItem(CART_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(CART_TOKEN_KEY, token);
  }
  return token;
}

async function cartApi(endpoint: string, options: RequestInit = {}) {
  const token = getOrCreateCartToken();
  const response = await fetch(`/api/v1/cart${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Cart-Token': token,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Cart API error: ${response.status}`);
  }
  return response.json();
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    cartApi('')
      .then((cart) => {
        setItems(cart.items || []);
      })
      .catch((err) => {
        console.error('Failed to load cart:', err);
      });
  }, []);

  const addToCart = useCallback(async (product: Product) => {
    // Optimistic update
    setItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.product.id === product.id);
      if (existingItem) {
        return prevItems.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prevItems, { product, quantity: 1 }];
    });

    try {
      const cart = await cartApi('/items', {
        method: 'POST',
        body: JSON.stringify({ product_id: product.id, quantity: 1 }),
      });
      setItems(cart.items || []);
    } catch (err) {
      console.error('Failed to add to cart:', err);
    }
  }, []);

  const removeFromCart = useCallback(async (productId: number) => {
    // Optimistic update
    setItems((prevItems) => prevItems.filter((item) => item.product.id !== productId));

    try {
      const cart = await cartApi(`/items/${productId}`, { method: 'DELETE' });
      setItems(cart.items || []);
    } catch (err) {
      console.error('Failed to remove from cart:', err);
    }
  }, []);

  const updateQuantity = useCallback(async (productId: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    // Optimistic update
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );

    try {
      const cart = await cartApi(`/items/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity }),
      });
      setItems(cart.items || []);
    } catch (err) {
      console.error('Failed to update quantity:', err);
    }
  }, [removeFromCart]);

  const clearCart = useCallback(async () => {
    // Optimistic update
    setItems([]);

    try {
      const cart = await cartApi('', { method: 'DELETE' });
      setItems(cart.items || []);
    } catch (err) {
      console.error('Failed to clear cart:', err);
    }
  }, []);

  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }, [items]);

  const itemCount = useMemo(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  const value = useMemo(() => ({
    items,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    total,
    itemCount,
  }), [items, addToCart, removeFromCart, updateQuantity, clearCart, total, itemCount]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextType => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
