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
    <Box sx={{ display: 'flex', gap: 1, mr: 2 }}>
      {navItems.map((item) => (
        <Button
          key={item.path}
          component={Link}
          to={item.path}
          color="inherit"
          variant={location.pathname === item.path ? 'outlined' : 'text'}
        >
          {item.label}
        </Button>
      ))}
    </Box>
  );
};

export default Navigation;
