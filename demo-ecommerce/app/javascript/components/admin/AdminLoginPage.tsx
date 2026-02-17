import React from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';

interface AdminLoginPageProps {
  onLoginSuccess: () => void;
}

interface LoginLocationState {
  from?: string;
}

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin';

const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');

  const redirectTo = (location.state as LoginLocationState | null)?.from ?? '/admin';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      setError('Invalid username or password. Use admin/admin.');
      return;
    }

    setError('');
    onLoginSuccess();
    navigate(redirectTo, { replace: true });
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Admin Login
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in with username <strong>admin</strong> and password <strong>admin</strong>.
          </Typography>
          <Box component="form" data-cy="admin-login-form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                slotProps={{ htmlInput: { 'data-cy': 'admin-username-input' } }}
                required
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                slotProps={{ htmlInput: { 'data-cy': 'admin-password-input' } }}
                required
              />
              {error ? (
                <Alert data-cy="admin-login-error" severity="error">
                  {error}
                </Alert>
              ) : null}
              <Button type="submit" data-cy="admin-login-submit" variant="contained" size="large">
                Login
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AdminLoginPage;
