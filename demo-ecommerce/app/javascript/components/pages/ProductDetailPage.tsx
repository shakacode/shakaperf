import React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Grid,
  Button,
  Chip,
  Box,
  Breadcrumbs,
  Paper,
} from '@mui/material';
import { ShoppingCart, ArrowBack } from '@mui/icons-material';
import { useProduct } from '../../hooks/useProducts';
import { useCart } from '../../hooks/useCart';
import LoadingSpinner from '../shared/LoadingSpinner';

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { product, loading, error } = useProduct(Number(id));
  const { addToCart } = useCart();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !product) {
    return (
      <Container maxWidth="lg" className="py-8">
        <Typography color="error" className="text-center">
          {error || 'Product not found'}
        </Typography>
        <Box className="text-center mt-4">
          <Button component={Link} to="/products" startIcon={<ArrowBack />}>
            Back to Products
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" className="py-8">
      <Breadcrumbs className="mb-6">
        <Link to="/" className="text-blue-600 hover:underline">
          Home
        </Link>
        <Link to="/products" className="text-blue-600 hover:underline">
          Products
        </Link>
        <Typography color="text.primary">{product.name}</Typography>
      </Breadcrumbs>

      <Paper elevation={2} className="p-6">
        <Grid container spacing={4}>
          <Grid item xs={12} md={6}>
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full rounded-lg object-cover"
              style={{ maxHeight: '400px' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Box className="flex items-start gap-2 mb-2">
              <Typography variant="h4" component="h1" className="font-bold">
                {product.name}
              </Typography>
              {product.featured && <Chip label="Featured" color="primary" />}
            </Box>

            <Chip label={product.category} variant="outlined" className="mb-4" />

            <Typography variant="h3" color="primary" className="font-bold mb-4">
              ${product.price.toFixed(2)}
            </Typography>

            <Typography variant="body1" className="mb-6 text-gray-700">
              {product.description}
            </Typography>

            <Typography
              variant="body2"
              className={`mb-6 ${product.stock > 10 ? 'text-green-600' : 'text-orange-600'}`}
            >
              {product.stock > 0
                ? `${product.stock} items in stock`
                : 'Out of stock'}
            </Typography>

            <Box className="flex gap-4">
              <Button
                variant="contained"
                size="large"
                startIcon={<ShoppingCart />}
                onClick={() => addToCart(product)}
                disabled={product.stock === 0}
              >
                Add to Cart
              </Button>
              <Button
                variant="outlined"
                size="large"
                component={Link}
                to="/products"
                startIcon={<ArrowBack />}
              >
                Back to Products
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>
    </Container>
  );
};

export default ProductDetailPage;
