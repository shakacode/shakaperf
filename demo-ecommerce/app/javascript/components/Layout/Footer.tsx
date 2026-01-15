import React from 'react';
import { Box, Container, Typography, Link as MuiLink } from '@mui/material';

const Footer: React.FC = () => {
  return (
    <Box
      component="footer"
      sx={{
        bgcolor: '#f5f5f5',
        mt: 'auto',
        py: 3,
        borderTop: '1px solid #e0e0e0',
      }}
    >
      <Container maxWidth="lg">
        <Typography variant="body2" color="text.secondary" align="center">
          {'© '}
          {new Date().getFullYear()}{' '}
          <MuiLink
            color="inherit"
            href="https://shakacode.com"
            target="_blank"
            rel="noopener"
            sx={{ '&:hover': { color: '#667eea' } }}
          >
            ShakaCode
          </MuiLink>
          {' — Demo E-Commerce App'}
        </Typography>
        <Typography variant="caption" color="text.secondary" align="center" display="block" sx={{ mt: 1 }}>
          Built with React on Rails and Material UI
        </Typography>
      </Container>
    </Box>
  );
};

export default Footer;
