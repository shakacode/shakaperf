import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
} from '@mui/material';

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered';

const mockOrders = [
  { id: 'ORD-001', customer: 'John Doe', date: '2024-01-15', total: 129.99, status: 'delivered' as OrderStatus },
  { id: 'ORD-002', customer: 'Jane Smith', date: '2024-01-14', total: 89.50, status: 'shipped' as OrderStatus },
  { id: 'ORD-003', customer: 'Bob Wilson', date: '2024-01-14', total: 245.00, status: 'processing' as OrderStatus },
  { id: 'ORD-004', customer: 'Alice Brown', date: '2024-01-13', total: 67.25, status: 'pending' as OrderStatus },
  { id: 'ORD-005', customer: 'Charlie Davis', date: '2024-01-13', total: 199.99, status: 'delivered' as OrderStatus },
];

const getStatusColor = (status: OrderStatus) => {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'processing':
      return 'info';
    case 'shipped':
      return 'primary';
    case 'delivered':
      return 'success';
    default:
      return 'default';
  }
};

const OrderManagement: React.FC = () => {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Order Management
      </Typography>
      <Card>
        <CardContent>
          <TableContainer component={Paper} elevation={0}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Order ID</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mockOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>{order.id}</TableCell>
                    <TableCell>{order.customer}</TableCell>
                    <TableCell>{order.date}</TableCell>
                    <TableCell align="right">${order.total.toFixed(2)}</TableCell>
                    <TableCell align="center">
                      <Chip
                        label={order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                        color={getStatusColor(order.status)}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default OrderManagement;
