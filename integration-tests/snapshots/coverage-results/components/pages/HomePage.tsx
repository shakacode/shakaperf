/*                                                                                                                                   //     | 
 * Copyright (c) 2026 ShakaCode LLC.                                                                                                 //     | 
 *                                                                                                                                   //     | 
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf                                                                  //     | 
 * License in LICENSE.md.                                                                                                            //     | 
 */                                                                                                                                  //     | 
                                                                                                                                     //     | 
import React from 'react';                                                                                                           //     | 
import { Container, Typography, Box, Button, Paper } from '@mui/material';                                                           //     | 
import { ArrowForward, LocalShipping, Security, Support } from '@mui/icons-material';                                                //     | 
import { Link } from 'react-router-dom';                                                                                             //     | 
import { useProducts } from '../../hooks/useProducts';                                                                               //     | 
import ProductCard from '../shared/ProductCard';                                                                                     //     | 
import LoadingSpinner from '../shared/LoadingSpinner';                                                                               //     | 
import LazySection from '../shared/LazySection';                                                                                     //     | 
import ExperimentA11yRegressions from '../shared/ExperimentA11yRegressions';                                                         //     | 
                                                                                                                                     //     | 
const HomePage: React.FC = () => {                                                                                                   // A   | 
  const { products, loading, error } = useProducts();                                                                                // A   | 
  const featuredProducts = products.filter((p) => p.featured).slice(0, 4);                                                           // A   | 
                                                                                                                                     //     | 
  return (                                                                                                                           // A   | A=100%
    <Box sx={{ bgcolor: '#f5f5f5', minHeight: '100vh' }}>                                                                            //     | 
      {/* Hero Section */}                                                                                                           //     | 
      <Box                                                                                                                           //     | A=100%
        data-cy="hero-section"                                                                                                       //     | 
        sx={{                                                                                                                        //     | 
          background: 'linear-gradient(135deg, #4f46b5 0%, #764ba2 100%)',                                                           //     | 
          color: 'white',                                                                                                            //     | 
          py: { xs: 6, md: 14 },                                                                                                     //     | 
          mb: 6,                                                                                                                     //     | 
        }}                                                                                                                           //     | 
      >                                                                                                                              //     | 
        <Container maxWidth="lg">                                                                                                    //     | A=100%
          <Box sx={{ maxWidth: '600px' }}>                                                                                           //     | A=100%
            <Typography                                                                                                              //     | A=100%
              variant="h2"                                                                                                           //     | 
              component="h1"                                                                                                         //     | 
              sx={{ fontWeight: 700, mb: 2, fontSize: { xs: '2.5rem', md: '3.5rem' } }}                                              //     | 
            >                                                                                                                        //     | 
              Discover Your Style                                                                                                    //     | 
            </Typography>                                                                                                            //     | 
            <Typography variant="h6" component="p" sx={{ mb: 4, opacity: 0.9, fontWeight: 400 }} style={{ marginBottom: "150px" }}>  //     | A=100%
              Shop the latest trends with free shipping on orders over $50                                                           //     | 
            </Typography>                                                                                                            //     | 
            <Button                                                                                                                  //     | A=100%
              variant="contained"                                                                                                    //     | 
              component={Link}                                                                                                       //     | 
              to="/products"                                                                                                         //     | 
              endIcon={<ArrowForward />}                                                                                             //     | A=100%
              size="large"                                                                                                           //     | 
              sx={{                                                                                                                  //     | 
                bgcolor: 'white',                                                                                                    //     | 
                color: '#4f46b5',                                                                                                    //     | 
                px: 4,                                                                                                               //     | 
                py: 1.5,                                                                                                             //     | 
                fontWeight: 600,                                                                                                     //     | 
                '&:hover': { bgcolor: '#f0f0f0' },                                                                                   //     | 
              }}                                                                                                                     //     | 
            >                                                                                                                        //     | 
              Shop Now                                                                                                               //     | 
            </Button>                                                                                                                //     | 
          </Box>                                                                                                                     //     | 
        </Container>                                                                                                                 //     | 
      </Box>                                                                                                                         //     | 
                                                                                                                                     //     | 
      <Container maxWidth="lg">                                                                                                      //     | A=100%
        <ExperimentA11yRegressions />                                                                                                //     | 
                                                                                                                                     //     | 
        {/* Features Section */}                                                                                                     //     | 
        <Box                                                                                                                         //     | A=100%
          data-cy="features-section"                                                                                                 //     | 
          sx={{                                                                                                                      //     | 
            display: 'grid',                                                                                                         //     | 
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },                                                                //     | 
            gap: 3,                                                                                                                  //     | 
            mb: 6,                                                                                                                   //     | 
          }}                                                                                                                         //     | 
        >                                                                                                                            //     | 
          {[                                                                                                                         //     | 
            { icon: <LocalShipping />, title: 'Free Shipping', desc: 'On orders over $50' },                                         //     | A=100%
            { icon: <Security />, title: 'Secure Payment', desc: '100% secure checkout' },                                           //     | A=100%
            { icon: <Support />, title: '24/7 Support', desc: 'Dedicated support team' },                                            //     | A=100%
          ].map((feature, index) => (                                                                                                // A   | A=100%
            <Paper                                                                                                                   //     | 
              key={index}                                                                                                            //     | 
              elevation={0}                                                                                                          //     | 
              sx={{                                                                                                                  //     | 
                p: 3,                                                                                                                //     | 
                textAlign: 'center',                                                                                                 //     | 
                borderRadius: 2,                                                                                                     //     | 
                bgcolor: 'white',                                                                                                    //     | 
              }}                                                                                                                     //     | 
            >                                                                                                                        //     | 
              <Box sx={{ color: '#4f46b5', mb: 1 }}>{feature.icon}</Box>                                                             //     | A=100%
              <Typography variant="subtitle1" component="h2" fontWeight={600}>                                                       //     | A=100%
                {feature.title}                                                                                                      //     | 
              </Typography>                                                                                                          //     | 
              <Typography variant="body2" color="text.secondary">                                                                    //     | A=100%
                {feature.desc}                                                                                                       //     | 
              </Typography>                                                                                                          //     | 
            </Paper>                                                                                                                 //     | 
          ))}                                                                                                                        //     | 
        </Box>                                                                                                                       //     | 
                                                                                                                                     //     | 
        {/* Lazy-loaded: Featured Products */}                                                                                       //     | 
        <div>                                                                                                                        //     | A=100%
          <Box sx={{ mb: 6 }}>                                                                                                       //     | A=100%
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>                             //     | A=100%
              <Typography variant="h4" component="h2" fontWeight={700}>                                                              //     | A=100%
                Featured Products                                                                                                    //     | 
              </Typography>                                                                                                          //     | 
              <Button                                                                                                                //     | A=100%
                component={Link}                                                                                                     //     | 
                to="/products"                                                                                                       //     | 
                endIcon={<ArrowForward />}                                                                                           //     | A=100%
                sx={{ color: '#4f46b5' }}                                                                                            //     | 
              >                                                                                                                      //     | 
                View All                                                                                                             //     | 
              </Button>                                                                                                              //     | 
            </Box>                                                                                                                   //     | 
                                                                                                                                     //     | 
            {loading && <LoadingSpinner />}                                                                                          //     | 
                                                                                                                                     //     | 
            {error && (                                                                                                              //     | 
              <Typography color="error" sx={{ textAlign: 'center', py: 4 }}>                                                         //     | 
                {error}                                                                                                              //     | 
              </Typography>                                                                                                          //     | 
            )}                                                                                                                       //     | 
                                                                                                                                     //     | 
            {!loading && !error && (                                                                                                 //     | A=100%
              <Box                                                                                                                   //     | 
                sx={{                                                                                                                //     | 
                  display: 'grid',                                                                                                   //     | 
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },                                    //     | 
                  gap: 3,                                                                                                            //     | 
                }}                                                                                                                   //     | 
              >                                                                                                                      //     | 
                {featuredProducts.map((product) => (                                                                                 // A   | 
                  <ProductCard key={product.id} product={product} />                                                                 //     | 
                ))}                                                                                                                  //     | 
              </Box>                                                                                                                 //     | 
            )}                                                                                                                       //     | 
          </Box>                                                                                                                     //     | 
        </div>                                                                                                                       //     | 
      </Container>                                                                                                                   //     | 
    </Box>                                                                                                                           //     | 
  );                                                                                                                                 //     | 
};                                                                                                                                   //     | 
                                                                                                                                     //     | 
export default HomePage;                                                                                                             //     | 
                                                                                                                                     //     | 
