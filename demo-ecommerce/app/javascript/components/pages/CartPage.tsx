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
      <Container maxWidth="lg" className="py-8">
        <Paper className="p-8 text-center">
          <ShoppingBag className="text-gray-400 mb-4" style={{ fontSize: 80 }} />
          <Typography variant="h5" className="mb-4">
            Your cart is empty
          </Typography>
          <Button
            variant="contained"
            component={Link}
            to="/products"
            startIcon={<ArrowBack />}
          >
            Continue Shopping
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" className="py-8">
      <Typography variant="h4" component="h1" className="font-bold mb-6">
        Shopping Cart
      </Typography>

      <TableContainer component={Paper} className="mb-6">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="center">Quantity</TableCell>
              <TableCell align="right">Subtotal</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.product.id}>
                <TableCell>
                  <Box className="flex items-center gap-4">
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                    <Box>
                      <Link
                        to={`/products/${item.product.id}`}
                        className="text-blue-600 hover:underline font-medium"
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
                  <Box className="flex items-center justify-center gap-2">
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
                <TableCell align="right">
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

      <Paper className="p-6">
        <Box className="flex justify-between items-center mb-4">
          <Typography variant="h5">Total</Typography>
          <Typography variant="h4" color="primary" className="font-bold">
            ${total.toFixed(2)}
          </Typography>
        </Box>
        <Box className="flex gap-4 justify-end">
          <Button variant="outlined" color="error" onClick={clearCart}>
            Clear Cart
          </Button>
          <Button variant="contained" size="large">
            Proceed to Checkout
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default CartPage;
