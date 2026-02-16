import React, { useState } from 'react';
import {
  Container,
  Typography,
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
    <Box sx={{ bgcolor: '#f5f5f5', minHeight: '100vh', py: 4 }}>
      <Container maxWidth="lg">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            Products
          </Typography>
          <FormControl sx={{ minWidth: 200 }} size="small">
            <InputLabel id="category-label">Category</InputLabel>
            <Select
              labelId="category-label"
              value={category}
              label="Category"
              onChange={handleCategoryChange}
              sx={{ bgcolor: 'white' }}
              data-cy="category-select"
            >
              <MenuItem value="" data-cy="category-option-all">All Categories</MenuItem>
              {categories.map((cat) => (
                <MenuItem key={cat} value={cat} data-cy={`category-option-${cat.toLowerCase()}`}>
                  {cat}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {loading && <LoadingSpinner />}

        {error && (
          <Typography color="error" sx={{ textAlign: 'center', py: 2 }}>
            {error}
          </Typography>
        )}

        {!loading && !error && products.length === 0 && (
          <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
            No products found
          </Typography>
        )}

        {!loading && !error && products.length > 0 && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: 3,
            }}
          >
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </Box>
        )}
      </Container>
    </Box>
  );
};

export default ProductListPage;
