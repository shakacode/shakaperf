import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Button,
  Chip,
  Box,
  IconButton,
} from '@mui/material';
import { ShoppingCart, FavoriteBorder } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';

interface ProductCardProps {
  product: Product;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { addToCart } = useCart();

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 3,
        overflow: 'hidden',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 12px 24px rgba(0,0,0,0.1)',
        },
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Link to={`/products/${product.id}`} style={{ textDecoration: 'none' }}>
          <CardMedia
            component="img"
            sx={{
              height: 200,
              objectFit: 'cover',
              bgcolor: '#f8f9fa',
            }}
            image={product.image_url}
            alt={product.name}
          />
        </Link>
        {product.featured && (
          <Chip
            label="Featured"
            size="small"
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              bgcolor: '#667eea',
              color: 'white',
              fontWeight: 600,
            }}
          />
        )}
        <IconButton
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'white',
            '&:hover': { bgcolor: '#f5f5f5' },
          }}
          size="small"
        >
          <FavoriteBorder fontSize="small" />
        </IconButton>
      </Box>

      <CardContent sx={{ flexGrow: 1, p: 2.5 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: 1, mb: 0.5 }}
        >
          {product.category}
        </Typography>
        <Link to={`/products/${product.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Typography
            variant="subtitle1"
            component="h2"
            sx={{
              fontWeight: 600,
              mb: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: 1.3,
              minHeight: '2.6em',
            }}
          >
            {product.name}
          </Typography>
        </Link>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#667eea' }}>
            ${product?.price?.toFixed(2)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: product.stock > 0 ? 'success.main' : 'error.main',
              fontWeight: 500,
            }}
          >
            {product.stock > 0 ? 'In Stock' : 'Out of Stock'}
          </Typography>
        </Box>
      </CardContent>

      <Box sx={{ p: 2, pt: 0 }}>
        <Button
          variant="contained"
          startIcon={<ShoppingCart />}
          onClick={() => addToCart(product)}
          disabled={product.stock === 0}
          fullWidth
          sx={{
            bgcolor: '#667eea',
            borderRadius: 2,
            py: 1,
            fontWeight: 600,
            '&:hover': { bgcolor: '#5a6fd6' },
          }}
        >
          Add to Cart
        </Button>
      </Box>
    </Card>
  );
};

export default ProductCard;
