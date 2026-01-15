import React from 'react';
import { AppBar, Toolbar, Typography, Badge, IconButton, Box, Container } from '@mui/material';
import { ShoppingCart, Storefront } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useCart } from '../../hooks/useCart';
import Navigation from './Navigation';

const Header: React.FC = () => {
  const { itemCount } = useCart();

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: 'white',
        borderBottom: '1px solid #e0e0e0',
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: 64 }}>
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            <Storefront sx={{ color: '#667eea', mr: 1, fontSize: 28 }} />
            <Typography
              variant="h6"
              component="span"
              sx={{ fontWeight: 700, color: '#333', letterSpacing: '-0.5px' }}
            >
              Demo Store
            </Typography>
          </Link>
          <Box sx={{ flexGrow: 1 }} />
          <Navigation />
          <Link to="/cart" style={{ textDecoration: 'none', marginLeft: 8 }}>
            <IconButton
              aria-label="cart"
              sx={{
                color: '#667eea',
                '&:hover': { bgcolor: 'rgba(102, 126, 234, 0.08)' },
              }}
            >
              <Badge
                badgeContent={itemCount}
                sx={{
                  '& .MuiBadge-badge': {
                    bgcolor: '#667eea',
                    color: 'white',
                  },
                }}
              >
                <ShoppingCart />
              </Badge>
            </IconButton>
          </Link>
        </Toolbar>
      </Container>
    </AppBar>
  );
};

export default Header;
