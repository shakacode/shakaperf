import React from 'react';
import { Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Button,
  Box,
  TextField,
} from '@mui/material';
import { Delete, Add, Remove, ShoppingBag, ArrowBack } from '@mui/icons-material';
import { useCart } from '../../hooks/useCart';

const CartPage: React.FC = () => {
  const { items, removeFromCart, updateQuantity, clearCart, total } = useCart();

  if (items.length === 0) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <ShoppingBag sx={{ fontSize: 80, color: 'grey.400', mb: 2 }} />
          <Typography variant="h5" sx={{ mb: 2 }}>
            Your cart is empty
          </Typography>
          <Button
            variant="contained"
            component={Link}
            to="/products"
            startIcon={<ArrowBack />}
            sx={{ bgcolor: '#667eea', '&:hover': { bgcolor: '#5a6fd6' } }}
          >
            Continue Shopping
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 3 }}>
        Shopping Cart
      </Typography>

      <TableContainer component={Paper} sx={{ mb: 3, borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
              <TableCell sx={{ fontWeight: 600 }}>Product</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Price</TableCell>
              <TableCell align="center" sx={{ fontWeight: 600 }}>Quantity</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Subtotal</TableCell>
              <TableCell align="center" sx={{ fontWeight: 600 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.product.id}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box
                      component="img"
                      src={item.product.image_url}
                      alt={item.product.name}
                      sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1 }}
                    />
                    <Box>
                      <Link
                        to={`/products/${item.product.id}`}
                        style={{ color: '#667eea', textDecoration: 'none', fontWeight: 500 }}
                      >
                        {item.product.name}
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        {item.product.category}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell align="right">
                  ${item.product.price.toFixed(2)}
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    <IconButton
                      size="small"
                      onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                    >
                      <Remove />
                    </IconButton>
                    <TextField
                      size="small"
                      value={item.quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          updateQuantity(item.product.id, val);
                        }
                      }}
                      inputProps={{
                        style: { textAlign: 'center', width: '50px' },
                        min: 1,
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                    >
                      <Add />
                    </IconButton>
                  </Box>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  ${(item.product.price * item.quantity).toFixed(2)}
                </TableCell>
                <TableCell align="center">
                  <IconButton
                    color="error"
                    onClick={() => removeFromCart(item.product.id)}
                  >
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5">Total</Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, color: '#667eea' }}>
            ${total.toFixed(2)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <Button variant="outlined" color="error" onClick={clearCart}>
            Clear Cart
          </Button>
          <Button
            variant="contained"
            size="large"
            sx={{ bgcolor: '#667eea', '&:hover': { bgcolor: '#5a6fd6' } }}
          >
            Proceed to Checkout
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default CartPage;
