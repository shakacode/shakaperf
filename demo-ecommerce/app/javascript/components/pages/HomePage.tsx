import React from 'react';
import { Container, Typography, Box, Grid, Button } from '@mui/material';
import { ArrowForward } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useProducts } from '../../hooks/useProducts';
import ProductCard from '../shared/ProductCard';
import LoadingSpinner from '../shared/LoadingSpinner';

const HomePage: React.FC = () => {
  const { products, loading, error } = useProducts();
  const featuredProducts = products.filter((p) => p.featured).slice(0, 4);

  return (
    <Container maxWidth="lg" className="py-8">
      {/* Hero Section */}
      <Box className="bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg p-8 mb-8">
        <Typography variant="h3" component="h1" className="font-bold mb-4">
          Welcome to Demo Store
        </Typography>
        <Typography variant="h6" className="mb-6 opacity-90">
          Discover amazing products at great prices
        </Typography>
        <Button
          variant="contained"
          color="secondary"
          component={Link}
          to="/products"
          endIcon={<ArrowForward />}
          size="large"
        >
          Shop Now
        </Button>
      </Box>

      {/* Featured Products */}
      <Typography variant="h4" component="h2" className="font-bold mb-6">
        Featured Products
      </Typography>

      {loading && <LoadingSpinner />}

      {error && (
        <Typography color="error" className="text-center py-4">
          {error}
        </Typography>
      )}

      {!loading && !error && (
        <Grid container spacing={3}>
          {featuredProducts.map((product) => (
            <Grid item xs={12} sm={6} md={3} key={product.id}>
              <ProductCard product={product} />
            </Grid>
          ))}
        </Grid>
      )}

      {!loading && featuredProducts.length > 0 && (
        <Box className="text-center mt-8">
          <Button
            variant="outlined"
            component={Link}
            to="/products"
            endIcon={<ArrowForward />}
          >
            View All Products
          </Button>
        </Box>
      )}
    </Container>
  );
};

export default HomePage;
