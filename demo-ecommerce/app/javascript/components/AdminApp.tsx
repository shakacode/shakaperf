import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ThemeProvider from './ThemeProvider';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import ProductManagement from './admin/ProductManagement';
import OrderManagement from './admin/OrderManagement';
import AdminLoginPage from './admin/AdminLoginPage';

const ADMIN_AUTH_COOKIE_NAME = 'demo_ecommerce_admin_auth';

function hasAdminAuthCookie(): boolean {
  return document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .includes(`${ADMIN_AUTH_COOKIE_NAME}=1`);
}

function setAdminAuthCookie(): void {
  document.cookie = `${ADMIN_AUTH_COOKIE_NAME}=1; path=/; max-age=86400; samesite=lax`;
}

interface RequireAdminAuthProps {
  isAuthenticated: boolean;
  children: React.ReactElement;
}

const RequireAdminAuth: React.FC<RequireAdminAuthProps> = ({ isAuthenticated, children }) => {
  const location = useLocation();

  if (!isAuthenticated) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/admin/login" replace state={{ from: fromPath }} />;
  }

  return children;
};

const AdminApp: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = React.useState<boolean>(hasAdminAuthCookie);

  const handleLoginSuccess = () => {
    setAdminAuthCookie();
    setIsAuthenticated(true);
  };

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/admin/login"
            element={
              isAuthenticated ? (
                <Navigate to="/admin" replace />
              ) : (
                <AdminLoginPage onLoginSuccess={handleLoginSuccess} />
              )
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdminAuth isAuthenticated={isAuthenticated}>
                <AdminLayout>
                  <AdminDashboard />
                </AdminLayout>
              </RequireAdminAuth>
            }
          />
          <Route
            path="/admin/products"
            element={
              <RequireAdminAuth isAuthenticated={isAuthenticated}>
                <AdminLayout>
                  <ProductManagement />
                </AdminLayout>
              </RequireAdminAuth>
            }
          />
          <Route
            path="/admin/orders"
            element={
              <RequireAdminAuth isAuthenticated={isAuthenticated}>
                <AdminLayout>
                  <OrderManagement />
                </AdminLayout>
              </RequireAdminAuth>
            }
          />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default AdminApp;
