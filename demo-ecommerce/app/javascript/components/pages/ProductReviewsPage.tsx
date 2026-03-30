import React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Breadcrumbs,
  Paper,
  Avatar,
  Divider,
  Button,
} from '@mui/material';
import { Star, StarBorder, ArrowBack } from '@mui/icons-material';
import { useProduct } from '../../hooks/useProducts';
import LoadingSpinner from '../shared/LoadingSpinner';

const MOCK_REVIEWS = [
  {
    id: 1,
    author: 'Alex M.',
    rating: 5,
    date: 'March 12, 2026',
    title: 'Exceeded my expectations',
    body: 'Really impressed with the quality. Arrived quickly and looks exactly as described. Would definitely buy again.',
  },
  {
    id: 2,
    author: 'Jordan T.',
    rating: 4,
    date: 'February 28, 2026',
    title: 'Great value for the price',
    body: 'Solid product overall. Minor packaging issue on arrival but the item itself is in perfect condition.',
  },
  {
    id: 3,
    author: 'Sam R.',
    rating: 5,
    date: 'February 14, 2026',
    title: 'Highly recommend',
    body: "Bought this as a gift and the recipient loved it. Great build quality and exactly what we were looking for.",
  },
  {
    id: 4,
    author: 'Casey L.',
    rating: 3,
    date: 'January 30, 2026',
    title: 'Decent but room for improvement',
    body: 'Does the job but I expected a bit more based on the photos. Still a reasonable purchase at this price point.',
  },
];

const StarRating: React.FC<{ rating: number }> = ({ rating }) => (
  <Box sx={{ display: 'flex', color: '#f5a623' }}>
    {[1, 2, 3, 4, 5].map((n) =>
      n <= rating ? (
        <Star key={n} fontSize="small" />
      ) : (
        <StarBorder key={n} fontSize="small" />
      )
    )}
  </Box>
);

const ProductReviewsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { product, loading, error } = useProduct(Number(id));

  if (loading) return <LoadingSpinner />;

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

  const avgRating =
    MOCK_REVIEWS.reduce((sum, r) => sum + r.rating, 0) / MOCK_REVIEWS.length;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link to="/" style={{ color: '#667eea', textDecoration: 'none' }}>
          Home
        </Link>
        <Link to="/products" style={{ color: '#667eea', textDecoration: 'none' }}>
          Products
        </Link>
        <Link
          to={`/products/${id}`}
          style={{ color: '#667eea', textDecoration: 'none' }}
        >
          {product.name}
        </Link>
        <Typography color="text.primary">Reviews</Typography>
      </Breadcrumbs>

      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          Customer Reviews
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          {product.name}
        </Typography>
      </Box>

      <Paper
        elevation={0}
        sx={{ p: 3, mb: 4, borderRadius: 3, border: '1px solid #e0e0e0', display: 'flex', gap: 3, alignItems: 'center' }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h2" sx={{ fontWeight: 700, color: '#667eea', lineHeight: 1 }}>
            {avgRating.toFixed(1)}
          </Typography>
          <StarRating rating={Math.round(avgRating)} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {MOCK_REVIEWS.length} reviews
          </Typography>
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MOCK_REVIEWS.map((review, index) => (
          <React.Fragment key={review.id}>
            <Box sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Avatar sx={{ bgcolor: '#667eea', width: 36, height: 36, fontSize: 14 }}>
                  {review.author[0]}
                </Avatar>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {review.author}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {review.date}
                  </Typography>
                </Box>
                <Box sx={{ ml: 'auto' }}>
                  <StarRating rating={review.rating} />
                </Box>
              </Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {review.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {review.body}
              </Typography>
            </Box>
            {index < MOCK_REVIEWS.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </Box>

      <Box sx={{ mt: 4 }}>
        <Button
          variant="outlined"
          component={Link}
          to={`/products/${id}`}
          startIcon={<ArrowBack />}
          sx={{ borderColor: '#667eea', color: '#667eea' }}
        >
          Back to Product
        </Button>
      </Box>
    </Container>
  );
};

export default ProductReviewsPage;
