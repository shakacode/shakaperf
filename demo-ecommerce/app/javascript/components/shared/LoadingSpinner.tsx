import React from 'react';
import { CircularProgress, Box } from '@mui/material';

const LoadingSpinner = React.forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <Box
      ref={ref}
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="200px"
    >
      <CircularProgress />
    </Box>
  );
});

export default LoadingSpinner;
