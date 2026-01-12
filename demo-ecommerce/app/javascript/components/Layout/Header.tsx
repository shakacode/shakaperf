import React from 'react';
import { AppBar, Toolbar, Typography, Badge, IconButton, Box } from '@mui/material';
import { ShoppingCart, Store } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useCart } from '../../hooks/useCart';
import Navigation from './Navigation';

const Header: React.FC = () => {
  const { itemCount } = useCart();

  return (
    <AppBar position="sticky">
      <Toolbar>
        <Link to="/" className="no-underline text-white flex items-center">
          <Store className="mr-2" />
          <Typography variant="h6" component="span">
            Demo Store
          </Typography>
        </Link>
        <Box sx={{ flexGrow: 1 }} />
        <Navigation />
        <Link to="/cart" className="no-underline text-white">
          <IconButton color="inherit" aria-label="cart">
            <Badge badgeContent={itemCount} color="secondary">
              <ShoppingCart />
            </Badge>
          </IconButton>
        </Link>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
