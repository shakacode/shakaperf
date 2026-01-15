import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ThemeProvider from './ThemeProvider';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import ProductManagement from './admin/ProductManagement';
import OrderManagement from './admin/OrderManagement';

const AdminApp: React.FC = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AdminLayout>
          <Routes>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/products" element={<ProductManagement />} />
            <Route path="/admin/orders" element={<OrderManagement />} />
          </Routes>
        </AdminLayout>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default AdminApp;
