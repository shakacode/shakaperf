import React from 'react';
import { Box, Card, CardContent, Grid, Typography } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import PeopleIcon from '@mui/icons-material/People';
import InventoryIcon from '@mui/icons-material/Inventory';

const stats = [
  { title: 'Total Revenue', value: '$12,345', icon: <TrendingUpIcon fontSize="large" />, color: '#4caf50' },
  { title: 'Orders', value: '156', icon: <ShoppingCartIcon fontSize="large" />, color: '#2196f3' },
  { title: 'Customers', value: '1,234', icon: <PeopleIcon fontSize="large" />, color: '#ff9800' },
  { title: 'Products', value: '89', icon: <InventoryIcon fontSize="large" />, color: '#9c27b0' },
];

const AdminDashboard: React.FC = () => {
  return (
    <Box>
      <Typography data-cy="admin-dashboard-title" variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Grid container spacing={3}>
        {stats.map((stat) => (
          <Grid item xs={12} sm={6} md={3} key={stat.title}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography color="textSecondary" gutterBottom>
                      {stat.title}
                    </Typography>
                    <Typography variant="h5">{stat.value}</Typography>
                  </Box>
                  <Box sx={{ color: stat.color }}>{stat.icon}</Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" gutterBottom>
          Recent Activity
        </Typography>
        <Card>
          <CardContent>
            <Typography color="textSecondary">
              No recent activity to display. This is a placeholder dashboard.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

export default AdminDashboard;
