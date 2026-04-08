import React from 'react';
import { Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Paper,
  Chip,
  Button,
} from '@mui/material';
import { LocalOffer } from '@mui/icons-material';

const DEALS = [
  {
    id: 1,
    title: 'Spring Sale',
    discount: '20% off',
    description: 'All clothing items discounted through the end of the month.',
    category: 'Clothing',
    code: 'SPRING20',
    expires: 'April 30, 2026',
  },
  {
    id: 2,
    title: 'Electronics Bundle',
    discount: '15% off',
    description: 'Buy any two electronics and get 15% off your total order.',
    category: 'Electronics',
    code: 'ELEC15',
    expires: 'April 15, 2026',
  },
  {
    id: 3,
    title: 'Free Shipping Weekend',
    discount: 'Free shipping',
    description: 'Free standard shipping on all orders this weekend. No minimum.',
    category: 'All',
    code: 'SHIPFREE',
    expires: 'April 6, 2026',
  },
  {
    id: 4,
    title: 'Home Essentials',
    discount: '10% off',
    description: 'Save on everything in the Home category.',
    category: 'Home',
    code: 'HOME10',
    expires: 'May 1, 2026',
  },
];

const DealsPage: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Box sx={{ mb: 5, textAlign: 'center' }}>
        <LocalOffer sx={{ fontSize: 48, color: '#667eea', mb: 1 }} />
        <Typography variant="h3" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          Deals & Promotions
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          Current offers available in store
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {DEALS.map((deal) => (
          <Paper
            key={deal.id}
            elevation={0}
            sx={{ p: 3, borderRadius: 3, border: '1px solid #e0e0e0' }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {deal.title}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label={deal.category} variant="outlined" size="small" />
                <Chip
                  label={deal.discount}
                  size="small"
                  sx={{ bgcolor: '#667eea', color: 'white', fontWeight: 600 }}
                />
              </Box>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {deal.description}
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Code:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    bgcolor: 'rgba(102, 126, 234, 0.1)',
                    color: '#667eea',
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    fontWeight: 600,
                  }}
                >
                  {deal.code}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Expires {deal.expires}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Box>

      <Box sx={{ mt: 5, textAlign: 'center' }}>
        <Button
          variant="contained"
          component={Link}
          to="/products"
          sx={{ bgcolor: '#667eea', '&:hover': { bgcolor: '#5a6fd6' } }}
        >
          Shop Now
        </Button>
      </Box>
    </Container>
  );
};

export default DealsPage;
