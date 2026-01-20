import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Button,
  Chip,
  Box,
  Breadcrumbs,
  Paper,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  Divider,
} from '@mui/material';
import { ShoppingCart, ArrowBack, ExpandMore } from '@mui/icons-material';
import { useProduct } from '../../hooks/useProducts';
import { useCart } from '../../hooks/useCart';
import LoadingSpinner from '../shared/LoadingSpinner';
import ProductFeatures from '../shared/ProductFeatures';

const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { product, loading, error } = useProduct(Number(id));
  const { addToCart } = useCart();
  const [tab, setTab] = useState(0);
  const [quantity, setQuantity] = useState(1);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !product) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography color="error" sx={{ textAlign: 'center' }}>
          {error || 'Product not found'}
        </Typography>
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button component={Link} to="/products" startIcon={<ArrowBack />}>
            Back to Products
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link to="/" style={{ color: '#667eea', textDecoration: 'none' }}>
          Home
        </Link>
        <Link to="/products" style={{ color: '#667eea', textDecoration: 'none' }}>
          Products
        </Link>
        <Typography color="text.primary">{product.name}</Typography>
      </Breadcrumbs>

      <Paper elevation={0} sx={{ p: 4, borderRadius: 3, border: '1px solid #e0e0e0' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 4,
          }}
        >
          <Box>
            <Box
              component="img"
              src={product.image_url}
              alt={product.name}
              sx={{
                width: '100%',
                maxHeight: 400,
                objectFit: 'cover',
                borderRadius: 2,
              }}
            />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                {product.name}
              </Typography>
              {product.featured && (
                <Chip
                  label="Featured"
                  size="small"
                  sx={{ bgcolor: '#667eea', color: 'white' }}
                />
              )}
            </Box>

            <Chip label={product.category} variant="outlined" sx={{ mb: 2 }} />

            <Typography variant="h3" sx={{ fontWeight: 700, color: '#667eea', mb: 2 }}>
              ${product.price.toFixed(2)}
            </Typography>

            <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
              {product.description}
            </Typography>

            <Typography
              variant="body2"
              sx={{
                mb: 3,
                color: product.stock > 10 ? 'success.main' : 'warning.main',
                fontWeight: 500,
              }}
            >
              {product.stock > 0
                ? `${product.stock} items in stock`
                : 'Out of stock'}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Typography variant="body2">Quantity:</Typography>
              <TextField
                type="number"
                size="small"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                inputProps={{ min: 1, max: product.stock }}
                sx={{ width: 80 }}
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<ShoppingCart />}
                onClick={() => addToCart(product)}
                disabled={product.stock === 0}
                sx={{ bgcolor: '#667eea', '&:hover': { bgcolor: '#5a6fd6' } }}
              >
                Add to Cart
              </Button>
              <Button
                variant="outlined"
                size="large"
                component={Link}
                to="/products"
                startIcon={<ArrowBack />}
                sx={{ borderColor: '#667eea', color: '#667eea' }}
              >
                Back to Products
              </Button>
            </Box>
          </Box>
        </Box>
      </Paper>

      <Divider sx={{ my: 4 }} />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Description" />
        <Tab label="Specifications" />
        <Tab label="FAQ" />
      </Tabs>

      {tab === 0 && (
        <Typography>{product.description}</Typography>
      )}

      {tab === 1 && (
        <Box>
          <Typography variant="body2">Category: {product.category}</Typography>
          <Typography variant="body2">Stock: {product.stock} units</Typography>
        </Box>
      )}

      {tab === 2 && (
        <Box>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>What is the return policy?</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography>30-day money back guarantee.</Typography>
            </AccordionDetails>
          </Accordion>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>How long does shipping take?</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography>3-5 business days for standard shipping.</Typography>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      <ProductFeatures productName={product.name} />
    </Container>
  );
};

export default ProductDetailPage;
