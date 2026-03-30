import React from 'react';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { label: 'Home', path: '/' },
  { label: 'Products', path: '/products' },
  { label: 'Deals', path: '/deals' },
  { label: 'Carousel Demo', path: '/carousel-demo' },
];

const Navigation: React.FC = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const openMobileMenu = () => {
    setMobileMenuOpen(true);
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <>
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5, mr: 2 }}>
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

      <IconButton
        aria-label="open navigation menu"
        onClick={openMobileMenu}
        sx={{
          display: { xs: 'inline-flex', sm: 'none' },
          color: '#667eea',
          mr: 1,
          '&:hover': { bgcolor: 'rgba(102, 126, 234, 0.08)' },
        }}
      >
        <MenuIcon />
      </IconButton>

      <Drawer anchor="left" open={mobileMenuOpen} onClose={closeMobileMenu}>
        <Box sx={{ width: 260 }} role="presentation">
          <Box sx={{ px: 2, py: 2, borderBottom: '1px solid #e0e0e0' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Demo Store
            </Typography>
          </Box>
          <List sx={{ py: 0 }}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <ListItemButton
                  key={item.path}
                  component={Link}
                  to={item.path}
                  onClick={closeMobileMenu}
                  selected={isActive}
                  sx={{
                    '&.Mui-selected': {
                      bgcolor: 'rgba(102, 126, 234, 0.12)',
                      color: '#667eea',
                    },
                    '&.Mui-selected:hover': {
                      bgcolor: 'rgba(102, 126, 234, 0.16)',
                    },
                  }}
                >
                  <ListItemText primary={item.label} />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Drawer>
    </>
  );
};

export default Navigation;
