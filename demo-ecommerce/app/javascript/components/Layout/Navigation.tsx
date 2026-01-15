import React from 'react';
import { Button, Box } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { label: 'Home', path: '/' },
  { label: 'Products', path: '/products' },
];

const Navigation: React.FC = () => {
  const location = useLocation();

  return (
    <Box sx={{ display: 'flex', gap: 0.5, mr: 2 }}>
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Button
            key={item.path}
            component={Link}
            to={item.path}
            sx={{
              color: isActive ? '#667eea' : '#666',
              fontWeight: isActive ? 600 : 500,
              borderRadius: 2,
              px: 2,
              '&:hover': {
                bgcolor: 'rgba(102, 126, 234, 0.08)',
                color: '#667eea',
              },
            }}
          >
            {item.label}
          </Button>
        );
      })}
    </Box>
  );
};

export default Navigation;
