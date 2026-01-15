import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import loadable from '@loadable/component';
import { Box } from '@mui/material';
import ThemeProvider from './ThemeProvider';
import { CartProvider } from '../hooks/useCart';
import Header from './Layout/Header';
import Footer from './Layout/Footer';
import LoadingSpinner from './shared/LoadingSpinner';

// Code-split page components
const HomePage = loadable(() => import('./pages/HomePage'), {
  fallback: <LoadingSpinner />,
});

const ProductListPage = loadable(() => import('./pages/ProductListPage'), {
  fallback: <LoadingSpinner />,
});

const ProductDetailPage = loadable(() => import('./pages/ProductDetailPage'), {
  fallback: <LoadingSpinner />,
});

const CartPage = loadable(() => import('./pages/CartPage'), {
  fallback: <LoadingSpinner />,
});

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <CartProvider>
        <BrowserRouter>
          <Box
            id="root"
            sx={{
              minHeight: '100vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Header />
            <Box component="main" sx={{ flexGrow: 1 }}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/products" element={<ProductListPage />} />
                <Route path="/products/:id" element={<ProductDetailPage />} />
                <Route path="/cart" element={<CartPage />} />
              </Routes>
            </Box>
            <Footer />
          </Box>
        </BrowserRouter>
      </CartProvider>
    </ThemeProvider>
  );
};

export default App;
