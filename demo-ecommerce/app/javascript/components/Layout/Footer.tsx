import React from 'react';
import { Box, Container, Typography, Link as MuiLink } from '@mui/material';

const Footer: React.FC = () => {
  return (
    <Box
      component="footer"
      className="bg-gray-100 mt-auto py-6"
    >
      <Container maxWidth="lg">
        <Typography variant="body2" color="text.secondary" align="center">
          {'© '}
          {new Date().getFullYear()}{' '}
          <MuiLink color="inherit" href="https://shakacode.com" target="_blank" rel="noopener">
            ShakaCode
          </MuiLink>
          {' — Demo E-Commerce App'}
        </Typography>
        <Typography variant="caption" color="text.secondary" align="center" display="block" mt={1}>
          Built with React on Rails, Material UI, and TailwindCSS
        </Typography>
      </Container>
    </Box>
  );
};

export default Footer;
