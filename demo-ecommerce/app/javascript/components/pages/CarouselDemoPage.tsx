import React from 'react';
import { Box, Chip, Container, Paper, Stack, Typography } from '@mui/material';

interface CarouselSlide {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
}

const slides: CarouselSlide[] = [
  {
    id: '1',
    title: 'Summer Collection',
    subtitle: 'Fresh arrivals inspired by beach days',
    imageUrl: 'https://picsum.photos/id/1015/1200/500.jpg',
  },
  {
    id: '2',
    title: 'Tech Essentials',
    subtitle: 'Smart gear for work and play',
    imageUrl: 'https://picsum.photos/id/1005/1200/500.jpg',
  },
  {
    id: '3',
    title: 'Home Comfort',
    subtitle: 'Curated picks for a cozy space',
    imageUrl: 'https://picsum.photos/id/1048/1200/500.jpg',
  },
];

const duplicatedSlides = [...slides, ...slides];

const CarouselDemoPage: React.FC = () => {
  return (
    <Box sx={{ bgcolor: '#f5f5f5', minHeight: '100vh', py: 6 }}>
      <Container maxWidth="lg">
        <Stack spacing={2} sx={{ mb: 3 }}>
          <Chip label="Visual Regression Demo" sx={{ width: 'fit-content' }} />
          <Typography variant="h3" component="h1" fontWeight={700}>
            Material UI Carousel Demo
          </Typography>
          <Typography color="text.secondary">
            This carousel intentionally auto-animates so visreg scenarios can demonstrate CSS animation
            pausing and image stubbing.
          </Typography>
        </Stack>

        <Paper elevation={0} sx={{ borderRadius: 3, p: 2, bgcolor: 'white' }}>
          <Box
            data-cy="marketing-carousel"
            sx={{
              overflow: 'hidden',
              borderRadius: 2,
              border: '1px solid #ececec',
              position: 'relative',
            }}
          >
            <Box
              data-cy="marketing-carousel-track"
              sx={{
                display: 'flex',
                width: 'fit-content',
                animation: 'carousel-track-scroll 18s linear infinite',
                '@keyframes carousel-track-scroll': {
                  '0%': { transform: 'translateX(0)' },
                  '100%': { transform: 'translateX(-50%)' },
                },
              }}
            >
              {duplicatedSlides.map((slide, index) => (
                <Box key={`${slide.id}-${index}`} sx={{ minWidth: '100%', position: 'relative' }}>
                  <Box
                    component="img"
                    data-cy="carousel-slide-image"
                    src={slide.imageUrl}
                    alt={slide.title}
                    sx={{
                      width: '100%',
                      height: { xs: 240, md: 440 },
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      background:
                        'linear-gradient(180deg, rgba(0,0,0,0.15) 20%, rgba(0,0,0,0.55) 100%)',
                      display: 'flex',
                      alignItems: 'flex-end',
                      p: { xs: 2, md: 4 },
                    }}
                  >
                    <Box>
                      <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
                        {slide.title}
                      </Typography>
                      <Typography sx={{ color: 'rgba(255,255,255,0.9)' }}>{slide.subtitle}</Typography>
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default CarouselDemoPage;
