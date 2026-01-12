import React, { useState } from 'react';
import {
  Container,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useProducts } from '../../hooks/useProducts';
import ProductCard from '../shared/ProductCard';
import LoadingSpinner from '../shared/LoadingSpinner';

const ProductListPage: React.FC = () => {
  const [category, setCategory] = useState<string>('');
  const { products, loading, error } = useProducts(category || undefined);

  const categories = ['Electronics', 'Clothing', 'Home', 'Sports', 'Accessories'];

  const handleCategoryChange = (event: SelectChangeEvent) => {
    setCategory(event.target.value);
  };

  return (
    <Container maxWidth="lg" className="py-8">
      <Box className="flex justify-between items-center mb-6">
        <Typography variant="h4" component="h1" className="font-bold">
          Products
        </Typography>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="category-label">Category</InputLabel>
          <Select
            labelId="category-label"
            value={category}
            label="Category"
            onChange={handleCategoryChange}
          >
            <MenuItem value="">All Categories</MenuItem>
            {categories.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading && <LoadingSpinner />}

      {error && (
        <Typography color="error" className="text-center py-4">
          {error}
        </Typography>
      )}

      {!loading && !error && products.length === 0 && (
        <Typography className="text-center py-8 text-gray-500">
          No products found
        </Typography>
      )}

      {!loading && !error && products.length > 0 && (
        <Grid container spacing={3}>
          {products.map((product) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={product.id}>
              <ProductCard product={product} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
};

export default ProductListPage;
