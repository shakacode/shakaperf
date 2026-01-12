import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Typography,
  Button,
  Chip,
  Box,
} from '@mui/material';
import { ShoppingCart } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { useCart } from '../../hooks/useCart';

interface ProductCardProps {
  product: Product;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { addToCart } = useCart();

  return (
    <Card className="h-full flex flex-col">
      <Link to={`/products/${product.id}`} className="no-underline">
        <CardMedia
          component="img"
          height="200"
          image={product.image_url}
          alt={product.name}
          className="object-cover"
        />
      </Link>
      <CardContent className="flex-grow">
        <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
          <Typography variant="h6" component="h2" className="line-clamp-2">
            {product.name}
          </Typography>
          {product.featured && (
            <Chip label="Featured" color="primary" size="small" />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" className="line-clamp-2 mb-2">
          {product.description}
        </Typography>
        <Typography variant="h6" color="primary">
          ${product.price.toFixed(2)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
        </Typography>
      </CardContent>
      <CardActions>
        <Button
          variant="contained"
          startIcon={<ShoppingCart />}
          onClick={() => addToCart(product)}
          disabled={product.stock === 0}
          fullWidth
        >
          Add to Cart
        </Button>
      </CardActions>
    </Card>
  );
};

export default ProductCard;
