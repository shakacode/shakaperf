import React from 'react';
import { Container, Typography, Box, Button, Paper } from '@mui/material';
import { ArrowForward, LocalShipping, Security, Support } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useProducts } from '../../hooks/useProducts';
import ProductCard from '../shared/ProductCard';
import LoadingSpinner from '../shared/LoadingSpinner';

const HomePage: React.FC = () => {
  const { products, loading, error } = useProducts();
  const featuredProducts = products.filter((p) => p.featured).slice(0, 4);

  return (
    <Box sx={{ bgcolor: '#f5f5f5', minHeight: '100vh' }}>
      {/* Hero Section */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          py: { xs: 6, md: 10 },
          mb: 6,
        }}
      >
        <Container maxWidth="lg">
          <Box sx={{ maxWidth: '600px' }}>
            <Typography
              variant="h2"
              component="h1"
              sx={{ fontWeight: 700, mb: 2, fontSize: { xs: '2.5rem', md: '3.5rem' } }}
            >
              Discover Your Style
            </Typography>
            <Typography variant="h6" sx={{ mb: 4, opacity: 0.9, fontWeight: 400 }}>
              Shop the latest trends with free shipping on orders over $50
            </Typography>
            <Button
              variant="contained"
              component={Link}
              to="/products"
              endIcon={<ArrowForward />}
              size="large"
              sx={{
                bgcolor: 'white',
                color: '#667eea',
                px: 4,
                py: 1.5,
                fontWeight: 600,
                '&:hover': { bgcolor: '#f0f0f0' },
              }}
            >
              Shop Now
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg">
        {/* Features Section */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 3,
            mb: 6,
          }}
        >
          {[
            { icon: <LocalShipping />, title: 'Super Fine Shipping', desc: 'On orders over $50' },
            { icon: <Security />, title: 'Secure Payments', desc: '100% secure checkout' },
            { icon: <Support />, title: '24/7 Support', desc: 'Dedicated support team' },
          ].map((feature, index) => (
            <Paper
              key={index}
              elevation={0}
              sx={{
                p: 3,
                textAlign: 'center',
                borderRadius: 2,
                bgcolor: 'white',
              }}
            >
              <Box sx={{ color: '#667eea', mb: 1 }}>{feature.icon}</Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {feature.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {feature.desc}
              </Typography>
            </Paper>
          ))}
        </Box>

        {/* Featured Products */}
        <Box sx={{ mb: 6 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h4" component="h2" fontWeight={700}>
              Featured Products
            </Typography>
            <Button
              component={Link}
              to="/products"
              endIcon={<ArrowForward />}
              sx={{ color: '#667eea' }}
            >
              View All
            </Button>
          </Box>

          {loading && <LoadingSpinner />}

          {error && (
            <Typography color="error" sx={{ textAlign: 'center', py: 4 }}>
              {error}
            </Typography>
          )}

          {!loading && !error && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 3,
              }}
            >
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </Box>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default HomePage;
